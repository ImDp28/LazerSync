import mongoose, { Schema } from 'mongoose';
const groupSchema = new Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    members: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        }],
    currency: {
        type: String,
        default: 'INR',
        uppercase: true,
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    isDeleted: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });
export default mongoose.model('Group', groupSchema);
