import { Router } from "express";
import {
  bulkReorderTasks,
  createTask,
  deleteTask,
  getTasks,
  updateTask
} from "../controllers/task.controller";

const taskRouter = Router();

taskRouter.post("/", createTask);
taskRouter.get("/", getTasks);
taskRouter.put("/reorder", bulkReorderTasks);
taskRouter.put("/:id", updateTask);
taskRouter.delete("/:id", deleteTask);

export default taskRouter;
