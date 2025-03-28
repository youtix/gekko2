import { describe, expect, it } from 'vitest';
import { DEMA } from './dema.indicator';

describe('DEMA', () => {
  const dema = new DEMA({ period: 10 });
  it.each`
    candle           | expected
    ${{ close: 81 }} | ${81}
    ${{ close: 24 }} | ${62.15702479338843}
    ${{ close: 75 }} | ${65.1412471825695}
    ${{ close: 21 }} | ${49.61361928829998}
    ${{ close: 34 }} | ${42.57070741566336}
    ${{ close: 25 }} | ${34.59749509048799}
    ${{ close: 72 }} | ${44.4799729524619}
    ${{ close: 92 }} | ${58.6168391922143}
    ${{ close: 99 }} | ${71.49798637114888}
    ${{ close: 2 }}  | ${48.96394485056299}
    ${{ close: 86 }} | ${60.095241192962085}
    ${{ close: 80 }} | ${66.41965473810653}
    ${{ close: 76 }} | ${69.77997604557989}
    ${{ close: 8 }}  | ${49.75572911767096}
    ${{ close: 87 }} | ${61.086415748817195}
    ${{ close: 75 }} | ${65.56112611350791}
    ${{ close: 32 }} | ${54.6537462381849}
    ${{ close: 65 }} | ${57.51231851211959}
    ${{ close: 41 }} | ${51.73955057939422}
    ${{ close: 9 }}  | ${36.941596820151794}
    ${{ close: 13 }} | ${27.4341534996622}
    ${{ close: 26 }} | ${24.89002521075057}
    ${{ close: 56 }} | ${33.14097982029731}
    ${{ close: 28 }} | ${30.16381787064522}
    ${{ close: 65 }} | ${40.33071547887332}
    ${{ close: 58 }} | ${45.63811915119548}
    ${{ close: 17 }} | ${36.04594742271048}
    ${{ close: 90 }} | ${53.12735486322182}
    ${{ close: 87 }} | ${64.78921092296176}
    ${{ close: 86 }} | ${72.99957040351619}
    ${{ close: 99 }} | ${83.22304838955621}
    ${{ close: 3 }}  | ${58.85287916072166}
    ${{ close: 70 }} | ${62.84134838238706}
    ${{ close: 1 }}  | ${42.93804766689408}
    ${{ close: 27 }} | ${36.82301007497254}
    ${{ close: 9 }}  | ${26.454331684513573}
    ${{ close: 92 }} | ${46.3743294005034}
    ${{ close: 68 }} | ${53.28360623846343}
    ${{ close: 9 }}  | ${38.891184741942006}
  `('should correctly calculate DEMA with period 10 when adding $candle candle', ({ candle, expected }) => {
    dema.onNewCandle(candle);
    expect(dema.getResult()).to.equal(expected);
  });
});
