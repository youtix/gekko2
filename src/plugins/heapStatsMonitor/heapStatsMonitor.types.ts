import Yup from 'yup';
import { heapStatsMonitorSchema } from './heapStatsMonitor.schema';

export type HeapStatsMonitorConfig = Yup.InferType<typeof heapStatsMonitorSchema>;
