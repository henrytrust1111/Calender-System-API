import mongoose from "mongoose";

export const connectDB = async (): Promise<void> => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is not set in environment variables.");
  }

  try {
    await mongoose.connect(mongoUri);
    // Startup log allowed by requirement.
    console.log("MongoDB connected successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database connection error";
    console.error(`MongoDB connection failed: ${message}`);
    process.exit(1);
  }
};
