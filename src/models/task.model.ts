import { Schema, model, Document } from "mongoose";

export interface ITask extends Document {
  title: string;
  date: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    order: {
      type: Number,
      required: true,
      min: 0
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

taskSchema.index({ date: 1 });
// Prevent duplicate order values for tasks on the same date.
taskSchema.index({ date: 1, order: 1 }, { unique: true });

export const TaskModel = model<ITask>("Task", taskSchema);
