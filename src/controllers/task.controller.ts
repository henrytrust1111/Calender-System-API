import { NextFunction, Request, Response } from "express";
import mongoose, { ClientSession } from "mongoose";
import { z } from "zod";
import { TaskModel, ITask } from "../models/task.model";
import { ApiError } from "../middleware/error.middleware";
import { ApiResponse, PaginationMeta, ReorderTaskItem, TaskQuery } from "../types/task.types";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title must not be empty"),
  date: z.string().regex(isoDateRegex, "Date must be valid ISO date (YYYY-MM-DD)")
});

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "Title must not be empty").optional(),
    date: z.string().regex(isoDateRegex, "Date must be valid ISO date (YYYY-MM-DD)").optional()
  })
  .refine((data) => data.title !== undefined || data.date !== undefined, {
    message: "At least one field (title or date) must be provided"
  });

const reorderSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().min(1, "Task id is required"),
        order: z.number().int().min(0, "Order must be >= 0")
      })
    )
    .min(1, "Tasks array must not be empty")
});

const listQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(9999),
  month: z.coerce.number().int().min(1).max(12),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100)
});

const isValidISODate = (value: string): boolean => {
  if (!isoDateRegex.test(value)) {
    return false;
  }

  const [yearString, monthString, dayString] = value.split("-");
  const year = Number(yearString);
  const month = Number(monthString);
  const day = Number(dayString);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
};

const assertValidDate = (date: string): void => {
  if (!isValidISODate(date)) {
    throw new ApiError(400, "Date must be a valid calendar ISO date (YYYY-MM-DD)");
  }
};

const getMonthDateRange = (year: number, month: number): { startDate: string; endDate: string } => {
  const monthString = String(month).padStart(2, "0");
  const startDate = `${year}-${monthString}-01`;
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${monthString}-${String(endDay).padStart(2, "0")}`;

  return { startDate, endDate };
};

const normalizeDateOrders = async (date: string, session?: ClientSession): Promise<void> => {
  const tasks = await TaskModel.find({ date }).sort({ order: 1, _id: 1 }).session(session ?? null);

  if (tasks.length === 0) {
    return;
  }

  const highestOrder = Math.max(...tasks.map((task) => task.order));

  // Two-phase update avoids transient unique-index collisions for (date, order).
  await TaskModel.bulkWrite(
    tasks.map((task, index) => ({
      updateOne: {
        filter: { _id: task._id },
        update: { $set: { order: highestOrder + index + 1 } }
      }
    })),
    { session }
  );

  await TaskModel.bulkWrite(
    tasks.map((task, index) => ({
      updateOne: {
        filter: { _id: task._id },
        update: { $set: { order: index } }
      }
    })),
    { session }
  );
};

export const createTask = async (
  req: Request,
  res: Response<ApiResponse<ITask>>,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
    }

    const { title, date } = parsed.data;
    assertValidDate(date);

    const order = await TaskModel.countDocuments({ date });

    const createdTask = await TaskModel.create({
      title,
      date,
      order
    });

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: createdTask
    });
  } catch (error) {
    next(error);
  }
};

export const getTasks = async (
  req: Request,
  res: Response<ApiResponse<{ items: ITask[]; pagination: PaginationMeta }>>,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid query parameters");
    }

    const query: TaskQuery = parsed.data;
    const { startDate, endDate } = getMonthDateRange(query.year, query.month);
    const skip = (query.page - 1) * query.limit;

    const filter = {
      date: {
        $gte: startDate,
        $lte: endDate
      }
    };

    const [items, total] = await Promise.all([
      TaskModel.find(filter).sort({ date: 1, order: 1 }).skip(skip).limit(query.limit),
      TaskModel.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      message: "Tasks fetched successfully",
      data: {
        items,
        pagination: {
          total,
          page: query.page,
          limit: query.limit
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateTask = async (
  req: Request<{ id: string }>,
  res: Response<ApiResponse<ITask>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, "Invalid task id");
    }

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
    }

    const task = await TaskModel.findById(id);
    if (!task) {
      throw new ApiError(404, "Task not found");
    }

    const { title, date } = parsed.data;
    const oldDate = task.date;

    if (title !== undefined) {
      task.title = title;
    }

    if (date !== undefined) {
      assertValidDate(date);
      if (date !== task.date) {
        task.date = date;
        // Place moved task at the end of destination day list.
        task.order = await TaskModel.countDocuments({ date });
      }
    }

    const updatedTask = await task.save();

    if (date !== undefined && date !== oldDate) {
      // Repack source day orders after moving task out.
      await normalizeDateOrders(oldDate);
    }

    res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: updatedTask
    });
  } catch (error) {
    if (
      error instanceof mongoose.Error &&
      "code" in error &&
      (error as mongoose.Error & { code?: number }).code === 11000
    ) {
      next(new ApiError(409, "Duplicate order conflict detected; please retry operation"));
      return;
    }

    next(error);
  }
};

export const deleteTask = async (
  req: Request<{ id: string }>,
  res: Response<ApiResponse<null>>,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, "Invalid task id");
    }

    const deletedTask = await TaskModel.findByIdAndDelete(id);
    if (!deletedTask) {
      throw new ApiError(404, "Task not found");
    }

    await normalizeDateOrders(deletedTask.date);

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
      data: null
    });
  } catch (error) {
    next(error);
  }
};

export const bulkReorderTasks = async (
  req: Request,
  res: Response<ApiResponse<null>>,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
    }

    const tasks: ReorderTaskItem[] = parsed.data.tasks;
    const ids = tasks.map((item) => item.id);

    if (new Set(ids).size !== ids.length) {
      throw new ApiError(400, "Task ids must be unique");
    }

    if (tasks.some((item) => !mongoose.Types.ObjectId.isValid(item.id))) {
      throw new ApiError(400, "One or more task ids are invalid");
    }

    const existingTasks = await TaskModel.find({ _id: { $in: ids } });
    if (existingTasks.length !== ids.length) {
      throw new ApiError(404, "One or more tasks not found");
    }

    const dates = new Set(existingTasks.map((task) => task.date));
    if (dates.size !== 1) {
      throw new ApiError(400, "Bulk reorder only supports tasks within the same day");
    }

    const targetDate = existingTasks[0].date;
    const touchedOrders = tasks.map((item) => item.order);
    if (new Set(touchedOrders).size !== touchedOrders.length) {
      throw new ApiError(400, "Duplicate order values in payload are not allowed");
    }

    const allDayTasks = await TaskModel.find({ date: targetDate });
    const highestOrder = allDayTasks.length > 0 ? Math.max(...allDayTasks.map((task) => task.order)) : 0;

    // Phase 1: move updated tasks to a temporary high-order window to avoid collisions.
    await TaskModel.bulkWrite(
      tasks.map((item, index) => ({
        updateOne: {
          filter: { _id: item.id, date: targetDate },
          update: { $set: { order: highestOrder + index + 1 } }
        }
      }))
    );

    // Phase 2: assign requested order values.
    await TaskModel.bulkWrite(
      tasks.map((item) => ({
        updateOne: {
          filter: { _id: item.id, date: targetDate },
          update: { $set: { order: item.order } }
        }
      }))
    );

    await normalizeDateOrders(targetDate);

    res.status(200).json({
      success: true,
      message: "Tasks reordered successfully",
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          data: null
    });
  } catch (error) {
    if (
      error instanceof mongoose.Error &&
      "code" in error &&
      (error as mongoose.Error & { code?: number }).code === 11000
    ) {
      next(new ApiError(409, "Duplicate order conflict detected; please retry operation"));
      return;
    }
    next(error);
  }
};
