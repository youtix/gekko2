import { describe, expect, it } from 'vitest';
import { WMA } from './wma.indicator';

describe('WMA', () => {
  const wma = new WMA({ period: 9 });
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
    ${{ close: 99, open: 92, high: 101.5127586628106, low: 89.4872413371894, volume: 647 }}     | ${64.2}
    ${{ close: 2, open: 99, high: 99.0804764241746, low: 1.9195235758253941, volume: 396 }}     | ${52.977777777777774}
    ${{ close: 86, open: 2, high: 86.08306699694582, low: 1.916933003054178, volume: 252 }}     | ${60.31111111111111}
    ${{ close: 80, open: 86, high: 87.6552826540483, low: 78.3447173459517, volume: 299 }}      | ${65.06666666666666}
    ${{ close: 76, open: 80, high: 80.75068906338092, low: 75.24931093661908, volume: 469 }}    | ${68.91111111111111}
    ${{ close: 8, open: 76, high: 77.2154050332975, low: 6.784594966702496, volume: 605 }}      | ${57.93333333333333}
    ${{ close: 87, open: 8, high: 90.4594244098795, low: 4.540575590120497, volume: 261 }}      | ${63.333333333333336}
    ${{ close: 75, open: 87, high: 91.6843769949034, low: 70.3156230050966, volume: 926 }}      | ${64.95555555555555}
    ${{ close: 32, open: 75, high: 77.42509022428217, low: 29.57490977571783, volume: 544 }}    | ${57.91111111111111}
    ${{ close: 65, open: 32, high: 66.96254158787707, low: 30.037458412122934, volume: 819 }}   | ${58.8}
    ${{ close: 41, open: 65, high: 69.41431179251751, low: 36.58568820748249, volume: 1012 }}   | ${55.644444444444446}
    ${{ close: 9, open: 41, high: 43.081607806555546, low: 6.918392193444454, volume: 736 }}    | ${45.22222222222222}
    ${{ close: 13, open: 9, high: 15.19184083967761, low: 6.808159160322391, volume: 971 }}     | ${37.31111111111111}
    ${{ close: 26, open: 13, high: 28.498919258834377, low: 10.501080741165623, volume: 1098 }} | ${33.48888888888889}
    ${{ close: 56, open: 26, high: 59.7249059948739, low: 22.2750940051261, volume: 379 }}      | ${36.77777777777778}
    ${{ close: 28, open: 56, high: 58.44863123776439, low: 25.551368762235615, volume: 117 }}   | ${33.4}
    ${{ close: 65, open: 28, high: 66.775319062114, low: 26.224680937886014, volume: 1041 }}    | ${38.733333333333334}
    ${{ close: 58, open: 65, high: 68.65939501847261, low: 54.340604981527385, volume: 510 }}   | ${42.888888888888886}
    ${{ close: 17, open: 58, high: 60.01918882495998, low: 14.980811175040019, volume: 878 }}   | ${38.266666666666666}
    ${{ close: 90, open: 17, high: 93.37632122668938, low: 13.623678773310617, volume: 150 }}   | ${49.31111111111111}
    ${{ close: 87, open: 90, high: 91.79876207396401, low: 85.20123792603599, volume: 914 }}    | ${58.666666666666664}
    ${{ close: 86, open: 87, high: 90.67917429835809, low: 82.32082570164191, volume: 582 }}    | ${66.08888888888889}
    ${{ close: 99, open: 86, high: 103.90666224637769, low: 81.09333775362231, volume: 804 }}   | ${74.4888888888889}
    ${{ close: 3, open: 99, high: 100.63598126886475, low: 1.3640187311352432, volume: 436 }}   | ${62.06666666666667}
    ${{ close: 70, open: 3, high: 74.01339408473842, low: -1.0133940847384295, volume: 747 }}   | ${64.22222222222223}
    ${{ close: 1, open: 70, high: 70.62974231530183, low: 0.37025768469818, volume: 722 }}      | ${51.644444444444446}
    ${{ close: 27, open: 1, high: 30.879348918826008, low: -2.879348918826009, volume: 221 }}   | ${45.68888888888889}
    ${{ close: 9, open: 27, high: 29.207668220474442, low: 6.792331779525556, volume: 148 }}    | ${36.82222222222222}
    ${{ close: 92, open: 9, high: 96.46225023362183, low: 4.5377497663781705, volume: 331 }}    | ${44.733333333333334}
    ${{ close: 68, open: 92, high: 94.82774764949542, low: 65.17225235050458, volume: 338 }}    | ${47.8}
    ${{ close: 9, open: 68, high: 69.94866467256739, low: 7.051335327432617, volume: 823 }}     | ${39.48888888888889}
  `('should return $expected when candle close to $candle.close', ({ candle, expected }) => {
    wma.onNewCandle(candle);
    expect(wma.getResult()).toBeCloseTo(expected, 13);
  });
  const wma2 = new WMA({ period: 5 });
  it.each`
    candle                | expected
    ${{ close: 25.0 }}    | ${null}
    ${{ close: 24.875 }}  | ${null}
    ${{ close: 24.7813 }} | ${null}
    ${{ close: 24.5938 }} | ${null}
    ${{ close: 24.5 }}    | ${24.664606666666668}
    ${{ close: 24.625 }}  | ${24.622933333333332}
    ${{ close: 25.2188 }} | ${24.804193333333334}
    ${{ close: 27.25 }}   | ${25.6396}
  `('should return $expected when candle close to $candle.close', ({ candle, expected }) => {
    wma2.onNewCandle(candle);
    expect(wma2.getResult()).toBeCloseTo(expected, 13);
  });
});
