

# 💸 SmartSplit — Expense Splitter

**Split group expenses, settle debts in the fewest possible payments, and pay with a single UPI scan.**

A full-stack MERN application with real-time sync, AI receipt scanning, email-OTP authentication,
and a financial ledger built on integer arithmetic — so the numbers always add up to the last paisa.



</div>

---

## 📖 Table of Contents

- [The Problem](#-the-problem)
- [Feature Highlights](#-feature-highlights)
- [Engineering Highlights](#-engineering-highlights)
- [Tech Stack](#-tech-stack)
- [Data Model](#-data-model)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Project Structure](#-project-structure)
- [Roadmap](#-roadmap)
- [Author](#-author)

---

## 🎯 The Problem

Six friends go on a trip. One pays for the hotel, another for cabs, a third for dinner — split three
different ways, some of it unequally. By day four nobody knows who owes whom, and settling it means
fifteen awkward UPI transfers.

**SmartSplit fixes this in three ways:**

1. **Track anything** — multiple payers on a single bill, equal / exact / percentage splits, receipts scanned by AI.
2. **Simplify the debt** — a greedy cash-flow-minimization algorithm collapses N×N tangled debts into the smallest possible set of payments.
3. **Settle for real** — tap to pay, scan the receiver's auto-generated UPI QR, and the receiver approves the payment before the ledger moves.

---

## ✨ Feature Highlights

### 🔐 Authentication & Onboarding
| Feature | Details |
|---|---|
| **Email OTP verification** | 6-digit code delivered via Nodemailer, auto-expiring after 5 minutes through a MongoDB TTL index — no cron job, no cleanup task. |
| **JWT sessions** | 7-day signed tokens, attached automatically by an Axios request interceptor; a response interceptor clears the session on any `401`. |
| **Password security** | bcrypt hashing with per-user salts; passwords are never returned by any endpoint. |
| **Shadow-profile claiming** ⭐ | Add a friend to a group before they've ever signed up. A **guest user** is created instantly so their expenses are tracked from day one. When they later register with that email, the account is *claimed* — every trip, expense and balance is already waiting for them. Nothing is lost, nothing is re-entered. |

### 👥 Groups & Expenses
- **Group ledgers** with members, currency, soft-delete and creator-only permissions.
- **Multi-payer expenses** — "Aman paid ₹600, Riya paid ₹400" on the same ₹1000 bill.
- **Three split modes** — `EQUAL`, `EXACT` (rupee amounts), `PERCENTAGE`, validated on **both** client and server.
- **Categories** — Food, Travel, Accommodation, Entertainment, General, Settlement.
- **Email invites** — new members get a branded invite mail with a signup nudge (fire-and-forget, so a mail outage never blocks the request).
- **Safe group deletion** — the API recomputes every balance and refuses to delete a group while anyone is still owed money.

### 🤖 AI Receipt Scanner
Snap a photo of a bill and the merchant name + total are extracted and pre-filled into the expense form.

- **Plan A — Google Gemini 2.5 Flash** for structured vision extraction (`{ title, amount }`).
- **Plan B — automatic OCR fallback** (OCR.space + regex heuristics) if the AI key is missing, rate-limited, or returns malformed JSON.
- Uploads are capped at **5 MB** and held in memory only — nothing touches disk.

The user never sees a failure mode; the graceful degradation is invisible.

### 💳 Settlements That Actually Settle
- **Optimal settlement plan** — the fewest transactions that clear the entire group.
- **UPI QR generation** — each debt renders a scannable `upi://pay` deep-link QR pre-filled with the payee's VPA, name and exact amount. Scan → pay → done.
- **Two-phase confirmation** — a settlement is created as `PENDING` and only affects balances once the **receiver** approves it. Rejection is one tap away.
- **Fraud-resistant** — you can only record a settlement *you* paid, and only the receiver can approve or reject it.


## 🧠 Engineering Highlights

> The parts of this project I'd want to talk through in an interview.

### 1. Money is never a float

`0.1 + 0.2 !== 0.3` — and in a ledger, that drift compounds until balances stop reconciling.
All arithmetic happens in **integer paise** and converts back to rupees only at the API boundary.

```js
// backEnd/src/utils/money.js
export const toPaise  = (amount) => Math.round(Number(amount) * 100);
export const toRupees = (paise)  => paise / 100;
```

### 2. Equal splits that are provably zero-sum

Splitting ₹100 three ways naively gives `33.33 × 3 = 99.99` — a paisa vanishes from the ledger on
every single expense. The remainder is distributed deterministically instead:

```js
const base      = Math.floor(totalPaise / splits.length);        // 3333
const remainder = totalPaise - base * splits.length;             // 1
splitsPaise = splits.map((_, i) => base + (i < remainder ? 1 : 0)); // 3334, 3333, 3333 ✅
```

Every expense is validated to be **zero-sum before it is persisted**: payers must sum to the total,
splits must sum to the total. Percentage splits are allowed to absorb a few paise of rounding drift;
anything larger is rejected with a `400`.

### 3. Debt simplification (greedy cash-flow minimization)

Rather than storing "who owes whom" pairwise, the server derives a **net balance per person** from
the full expense history, then greedily matches the largest debtor against the largest creditor.

```
Raw debts (5 payments)        Net balances        Optimized plan (2 payments)
  A → B  ₹300                   A  −₹200            B → C  ₹300
  A → C  ₹200            →      B  −₹300      →     A → C  ₹200
  B → C  ₹400                   C  +₹500
  C → A  ₹100
  B → A  ₹200
```

`O(n log n)` to sort, `O(n)` to match — each iteration fully settles at least one person, so at most
`n − 1` transactions result. Implemented in [`minimizeTransactions.js`](backEnd/src/utils/minimizeTransactions.js),
with settle-and-deduct using the *same* rounded value so the emitted transactions can never drift
away from the underlying balances.

### 4. Race-safe settlement approval

A read-then-save approval would let two concurrent taps both succeed and double-credit the ledger.
Approval is a single **atomic compare-and-swap** — find, authorize and flip in one database round trip:

```js
const settlement = await Expense.findOneAndUpdate(
  { _id: settlementId, category: 'SETTLEMENT', settlementStatus: 'PENDING', 'splits.0.user': req.user.id },
  { $set: { settlementStatus: 'SETTLED', title: "Settlement Completed" } },
  { new: true }
);
if (!settlement) return res.status(409).json({ message: "Already processed, or not yours to approve" });
```

The query doubles as the authorization check: `'splits.0.user': req.user.id` means only the *receiver*
can ever match the document.

### 5. Defense in depth on authorization

- `protect` — verifies the JWT and hydrates `req.user`; `next()` deliberately sits **outside** the
  `try` block so a downstream error can't be misreported as a bad token (which previously sent a
  second response and crashed the process).
- `requireGroupMember` — blocks any request touching a group the caller isn't a member of. Without it,
  any authenticated user could read or write any group's ledger just by guessing an ObjectId. It reads
  the group id from either the URL params or the body, and lets genuinely personal (group-less)
  expenses pass through.
- A malformed ObjectId is caught and answered with `400`, not a 500 stack trace.

### 6. Soft deletes everywhere

Groups and expenses are never destroyed — `isDeleted` flags preserve the full financial audit trail
while hiding them from every query. Historical balances stay reconstructable.

---





---

## 🛠 Tech Stack

<table>
<tr><td valign="top" width="50%">

**Frontend**
- React 19 + JavaScript
- Vite 8 (build & dev server)
- Tailwind CSS v4 (`@tailwindcss/vite`)
- React Router 7
- Axios (interceptor-based auth)

</td><td valign="top" width="50%">

**Backend**
- Node.js + Express 5 + JavaScript
- MongoDB Atlas + Mongoose 9
- Socket.IO (rooms & broadcasts)
- JSON Web Tokens + bcryptjs
- Nodemailer (OTP + invite mail)
- Multer (in-memory uploads, 5 MB cap)
- `@google/genai` — Gemini 2.5 Flash
- Axios + form-data — OCR fallback
- dotenv · cors

</td></tr>
</table>

---

## 🗄 Data Model

```mermaid
erDiagram
    USER ||--o{ GROUP : "creates"
    USER }o--o{ GROUP : "member of"
    GROUP ||--o{ EXPENSE : "contains"
    USER ||--o{ EXPENSE : "pays / owes"
    USER ||--o| OTP : "verifies with"

    USER {
        ObjectId _id
        string name
        string email UK
        string password "bcrypt hash, optional for guests"
        boolean isGuest "shadow profile flag"
        string upiId "powers QR generation"
    }
    GROUP {
        ObjectId _id
        string name
        string description
        ObjectId[] members FK
        string currency "default INR"
        ObjectId createdBy FK
        boolean isDeleted "soft delete"
    }
    EXPENSE {
        ObjectId _id
        string title
        number totalAmount
        string category "FOOD|TRAVEL|ACCOMODATION|ENTERTAINMENT|GENERAL|SETTLEMENT"
        string splitType "EQUAL|EXACT|PERCENTAGE|SHARES"
        ObjectId groupId FK "null for personal"
        object[] payers "{ user, amount }"
        object[] splits "{ user, amountOwed }"
        string settlementStatus "PENDING|SETTLED|REJECTED"
        boolean isDeleted
        Date date
    }
    OTP {
        string email
        string otp
        Date createdAt "TTL index — auto-expires in 300s"
    }
```

**Why one collection for expenses and settlements?** A settlement *is* just an expense that moves
money the other way (`category: 'SETTLEMENT'`). One ledger, one balance computation, no reconciliation
between two sources of truth.

---




## 🚀 Getting Started

### Prerequisites
- **Node.js** 22.12+ and npm
- A **MongoDB** connection string (Atlas or local)
- A **Gmail app password** for OTP mail — [how to create one](https://support.google.com/accounts/answer/185833)
- *(Optional)* a **Google Gemini API key** — without it, receipt scanning silently falls back to OCR

### 1. Extract the converted project

```bash
cd LazerSync-JavaScript
```

### 2. Backend

```bash
cd backEnd
npm install
# create .env — see the table below
npm run dev          # node --watch with hot reload → http://localhost:5000
```

### 3. Frontend

```bash
cd frontEnd
npm install
# create .env with VITE_API_URL=http://localhost:5000/api
npm run dev          # Vite dev server → http://localhost:5173
```

> ⚠️ Set `FRONTEND_URL=http://localhost:5173` in the backend `.env` — CORS **and** the Socket.IO
> handshake are both locked to that exact origin.

### Scripts

| Location | Command | Description |
|---|---|---|
| `backEnd` | `npm run dev` | Hot-reloading dev server (`node --watch`) |
| `backEnd` | `npm start` | Run directly from JavaScript (`node`) |
| `frontEnd` | `npm run dev` | Vite dev server with HMR |
| `frontEnd` | `npm run build` | Production bundle → `dist/` |
| `frontEnd` | `npm run preview` | Serve the production build locally |
| `frontEnd` | `npm run lint` | ESLint across the app |

---

## 🔑 Environment Variables

### `backEnd/.env`
| Variable | Required | Description |
|---|:--:|---|
| `PORT` | — | API port (defaults to `5000`) |
| `MONGO_URI` | ✅ | MongoDB connection string — the server exits on startup without it |
| `JWT_SECRET` | ✅ | Signing secret for 7-day session tokens |
| `EMAIL_USER` | ✅ | Gmail address that sends OTP & invite mail |
| `EMAIL_PASS` | ✅ | Gmail **app password** (not your account password) |
| `FRONTEND_URL` | ✅ | Exact origin allowed by CORS and the Socket.IO handshake |
| `GEMINI_API_KEY` | ➖ | Enables AI receipt parsing; omit to use the OCR fallback |

### `frontEnd/.env`
| Variable | Required | Description |
|---|:--:|---|
| `VITE_API_URL` | ✅ | API base URL including `/api`. The Socket.IO URL is derived from it by stripping the suffix — one URL to configure, not two. |

> 🔒 Both `.env` files are git-ignored. Never commit real credentials.

---

## 📂 Project Structure

```
LazerSync-JavaScript/
├── backEnd/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── authController.js       # OTP, login, shadow-profile claiming, UPI
│   │   │   ├── groupController.js      # CRUD + guest creation + balance-guarded delete
│   │   │   └── expenseController.js    # Ledger, dashboard, settlements, AI receipts
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js       # JWT verification → req.user
│   │   │   └── groupMiddleware.js      # Group-membership authorization
│   │   ├── models/                     # User · Group · Expense · OTP (TTL)
│   │   ├── routes/                     # auth · groups · expenses
│   │   ├── utils/
│   │   │   ├── minimizeTransactions.js # ⭐ Greedy debt simplification
│   │   │   ├── money.js                # ⭐ Integer-paise arithmetic
│   │   │   └── sendEmail.js            # OTP + branded invite templates
│   │   └── index.js                    # Express + HTTP + Socket.IO bootstrap
│
└── frontEnd/
    ├── src/
    │   ├── api/                        # Axios instance + socket URL derivation
    │   ├── components/
    │   │   ├── AddExpenseModal.jsx     # Multi-payer, 3 split modes, AI scan
    │   │   ├── SettleUpSection.jsx     # Settlement plan + UPI QR
    │   │   ├── GroupLedger.jsx         # History + approve / reject
    │   │   ├── AddMemberModal.jsx · DeleteGroupModal.jsx · ProtectedRoute.jsx
    │   ├── context/AuthContext.jsx
    │   ├── pages/                      # Login · Register · Dashboard · GroupDetails
    │   └── main.jsx · App.jsx
    └── vite.config.js
```

---


## 🗺 Roadmap

- [ ] Automated test suite — unit tests for `minimizeCashFlow` and the paise arithmetic first
- [ ] `SHARES` split mode (already modelled in the schema, not yet in the UI)
- [ ] Multi-currency groups with live FX conversion (the `currency` field is in place)
- [ ] Expense edit & delete with full audit history
- [ ] Rate limiting on OTP requests and receipt uploads
- [ ] Refresh tokens + httpOnly cookie sessions
- [ ] Push notifications for pending settlement approvals
- [ ] CSV / PDF export of a group ledger
- [ ] PWA offline support

---

## 👤 Author

**Divyaprakash Tiwari**



---

<div align="center">

**Built to be correct to the last paisa.**

If this project was useful or interesting, a ⭐ on the repo is much appreciated.

</div>
