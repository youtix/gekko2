import { InputSources } from '@models/types/inputSources.types';

declare global {
  interface IndicatorRegistry {
    SuperGuppy: {
      input?: {
        src?: InputSources;
        period1?: number;
        period2?: number;
        period3?: number;
        period4?: number;
        period5?: number;
        period6?: number;
        period7?: number;
        period8?: number;
        period9?: number;
        period10?: number;
        period11?: number;
        period12?: number;
        period13?: number;
        period14?: number;
        period15?: number;
        period16?: number;
        period17?: number;
        period18?: number;
        period19?: number;
        period20?: number;
        period21?: number;
        period22?: number;
      };
      output: {
        results: number[];
        spread: number;
        fastRibbonBullish: boolean;
        fastRibbonBearish: boolean;
        slowRibbonBullish: boolean;
        slowRibbonBearish: boolean;
      } | null;
    };
  }
}

export {};
