import jwt from 'jsonwebtoken';
export const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        //Token from frontend comes in the request header
        token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
        res.status(401).json({ message: "Not authorized, no token provided" });
        return;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
            _id: decoded.id,
            id: decoded.id
        };
    }
    catch (error) {
        console.error("Token verification failed", error);
        res.status(401).json({ message: "Not authorized, token failed" });
        return;
    }
    // next() sits outside the try so a downstream error is never mistaken
    // for a bad token (which used to send a second response and crash)
    next();
};
