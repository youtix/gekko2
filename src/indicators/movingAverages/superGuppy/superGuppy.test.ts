import { describe, expect, it } from 'vitest';
import { SuperGuppy } from './superGuppy.indicator';

const guppy = new SuperGuppy({
  period1: 1,
  period2: 2,
  period3: 3,
  period4: 4,
  period5: 5,
  period6: 6,
  period7: 7,
  period8: 8,
  period9: 9,
  period10: 10,
  period11: 11,
  period12: 12,
  period13: 13,
  period14: 14,
  period15: 15,
  period16: 16,
  period17: 17,
  period18: 18,
  period19: 19,
  period20: 20,
  period21: 21,
  period22: 22,
});
describe('SuperGuppy', () => {
  it.each`
    candle                                                                                      | expected
    ${{ close: 81, open: 81, high: 82.96289647361662, low: 79.03710352638338, volume: 403 }}    | ${null}
    ${{ close: 24, open: 81, high: 83.85720988022568, low: 21.142790119774318, volume: 814 }}   | ${null}
    ${{ close: 75, open: 24, high: 76.94326596315126, low: 22.056734036848734, volume: 1064 }}  | ${null}
    ${{ close: 21, open: 75, high: 79.67167346434113, low: 16.328326535658874, volume: 330 }}   | ${null}
    ${{ close: 34, open: 21, high: 34.711649023641215, low: 20.28835097635878, volume: 964 }}   | ${null}
    ${{ close: 25, open: 34, high: 36.18138133787512, low: 22.818618662124877, volume: 214 }}   | ${null}
    ${{ close: 72, open: 25, high: 73.33035016836122, low: 23.669649831638775, volume: 860 }}   | ${null}
    ${{ close: 92, open: 72, high: 94.97523624952838, low: 69.02476375047162, volume: 486 }}    | ${null}
    ${{ close: 99, open: 92, high: 101.5127586628106, low: 89.4872413371894, volume: 647 }}     | ${null}
    ${{ close: 2, open: 99, high: 99.0804764241746, low: 1.9195235758253941, volume: 396 }}     | ${null}
    ${{ close: 86, open: 2, high: 86.08306699694582, low: 1.916933003054178, volume: 252 }}     | ${null}
    ${{ close: 80, open: 86, high: 87.6552826540483, low: 78.3447173459517, volume: 299 }}      | ${null}
    ${{ close: 76, open: 80, high: 80.75068906338092, low: 75.24931093661908, volume: 469 }}    | ${null}
    ${{ close: 8, open: 76, high: 77.2154050332975, low: 6.784594966702496, volume: 605 }}      | ${null}
    ${{ close: 87, open: 8, high: 90.4594244098795, low: 4.540575590120497, volume: 261 }}      | ${null}
    ${{ close: 75, open: 87, high: 91.6843769949034, low: 70.3156230050966, volume: 926 }}      | ${null}
    ${{ close: 32, open: 75, high: 77.42509022428217, low: 29.57490977571783, volume: 544 }}    | ${null}
    ${{ close: 65, open: 32, high: 66.96254158787707, low: 30.037458412122934, volume: 819 }}   | ${null}
    ${{ close: 41, open: 65, high: 69.41431179251751, low: 36.58568820748249, volume: 1012 }}   | ${null}
    ${{ close: 9, open: 41, high: 43.081607806555546, low: 6.918392193444454, volume: 736 }}    | ${null}
    ${{ close: 13, open: 9, high: 15.19184083967761, low: 6.808159160322391, volume: 971 }}     | ${null}
    ${{ close: 26, open: 13, high: 28.498919258834377, low: 10.501080741165623, volume: 1098 }} | ${{ spread: 28.421667003593278, fastRibbonBullish: false, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: true }}
    ${{ close: 56, open: 26, high: 59.7249059948739, low: 22.2750940051261, volume: 379 }}      | ${{ spread: 18.35553962144732, fastRibbonBullish: false, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 28, open: 56, high: 58.44863123776439, low: 25.551368762235615, volume: 117 }}   | ${{ spread: 21.434868534112397, fastRibbonBullish: false, fastRibbonBearish: true, slowRibbonBullish: false, slowRibbonBearish: true }}
    ${{ close: 65, open: 28, high: 66.775319062114, low: 26.224680937886014, volume: 1041 }}    | ${{ spread: 21.756320156787993, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 58, open: 65, high: 68.65939501847261, low: 54.340604981527385, volume: 510 }}   | ${{ spread: 11.85956761047671, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 17, open: 58, high: 60.01918882495998, low: 14.980811175040019, volume: 878 }}   | ${{ spread: 31.422809032170214, fastRibbonBullish: false, fastRibbonBearish: true, slowRibbonBullish: false, slowRibbonBearish: true }}
    ${{ close: 90, open: 17, high: 93.37632122668938, low: 13.623678773310617, volume: 150 }}   | ${{ spread: 41.349225894209134, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 87, open: 90, high: 91.79876207396401, low: 85.20123792603599, volume: 914 }}    | ${{ spread: 33.974410958686406, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 86, open: 87, high: 90.67917429835809, low: 82.32082570164191, volume: 582 }}    | ${{ spread: 29.53889238238103, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 99, open: 86, high: 103.90666224637769, low: 81.09333775362231, volume: 804 }}   | ${{ spread: 38.28500314414293, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 3, open: 99, high: 100.63598126886475, low: 1.3640187311352432, volume: 436 }}   | ${{ spread: 54.12867506126808, fastRibbonBullish: false, fastRibbonBearish: true, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 70, open: 3, high: 74.01339408473842, low: -1.0133940847384295, volume: 747 }}   | ${{ spread: 13.55085254675577, fastRibbonBullish: false, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 1, open: 70, high: 70.62974231530183, low: 0.37025768469818, volume: 722 }}      | ${{ spread: 51.56111368309835, fastRibbonBullish: false, fastRibbonBearish: true, slowRibbonBullish: false, slowRibbonBearish: true }}
    ${{ close: 27, open: 1, high: 30.879348918826008, low: -2.879348918826009, volume: 221 }}   | ${{ spread: 25.694560804724645, fastRibbonBullish: false, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: true }}
    ${{ close: 9, open: 27, high: 29.207668220474442, low: 6.792331779525556, volume: 148 }}    | ${{ spread: 37.743763958877835, fastRibbonBullish: false, fastRibbonBearish: true, slowRibbonBullish: false, slowRibbonBearish: true }}
    ${{ close: 92, open: 9, high: 96.46225023362183, low: 4.5377497663781705, volume: 331 }}    | ${{ spread: 44.328551143428946, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: true }}
    ${{ close: 68, open: 92, high: 94.82774764949542, low: 65.17225235050458, volume: 338 }}    | ${{ spread: 17.00020047750838, fastRibbonBullish: true, fastRibbonBearish: false, slowRibbonBullish: false, slowRibbonBearish: false }}
    ${{ close: 9, open: 68, high: 69.94866467256739, low: 7.051335327432617, volume: 823 }}     | ${{ spread: 39.4300154535356, fastRibbonBullish: false, fastRibbonBearish: true, slowRibbonBullish: false, slowRibbonBearish: true }}
  `('returns $expected when candle.close = $candle.close', ({ candle, expected }) => {
    guppy.onNewCandle(candle);
    const result = guppy.getResult();

    if (expected === null) {
      // Still warming-up: all EMAs not yet seeded
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      expect(result!.spread).toBeCloseTo(expected.spread, 13); // same 1e-13 tolerance as the TEMA test
      expect(result!.fastRibbonBullish).toBe(expected.fastRibbonBullish);
      expect(result!.fastRibbonBearish).toBe(expected.fastRibbonBearish);
      expect(result!.slowRibbonBullish).toBe(expected.slowRibbonBullish);
      expect(result!.slowRibbonBearish).toBe(expected.slowRibbonBearish);
    }
  });
});
