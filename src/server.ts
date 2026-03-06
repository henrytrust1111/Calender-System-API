import dotenv from "dotenv";
import app from "./app";
import { connectDB } from "./config/db";

dotenv.config();

const port = Number(process.env.PORT) || 5000;

const startServer = async (): Promise<void> => {
  await connectDB();

  app.listen(port, () => {
    // Startup log allowed by requirement.
    console.log(`Server running on port ${port}`);
  });
};

void startServer();
