import { Request } from "express";

export interface Task {
  _id: string;
  title: string;
  date: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
}

export interface TaskQuery {
  year: number;
  month: number;
  page: number;
  limit: number;
}

export interface ReorderTaskItem {
  id: string;
  order: number;
}

export interface AuthenticatedRequest extends Request {
  // Placeholder for future auth extension.
}
