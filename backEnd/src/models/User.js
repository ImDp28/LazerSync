import mongoose, { Schema } from 'mongoose';
const UserSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: false
    },
    isGuest: {
        type: Boolean,
        default: false
    },
    upiId: {
        type: String,
        default: "" // By default empty
    }
}, {
    timestamps: true
});
export default mongoose.model('User', UserSchema);
