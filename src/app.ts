import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import taskRouter from "./routes/task.routes";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "API is healthy"
  });
});

app.use("/api/tasks", taskRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
