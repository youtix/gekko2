import { z } from 'zod';
import { emaRibbonStrategySchema } from './emaRibbon.schema';

export type EMARibbonStrategyParams = z.infer<typeof emaRibbonStrategySchema>;
