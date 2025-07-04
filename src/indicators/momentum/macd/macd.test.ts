import { describe, expect, it } from 'vitest';
import { MACD } from './macd.indicator';

describe('MACD', () => {
  const macdIndicator = new MACD({ short: 4, long: 12, signal: 3 });

  it.each`
    candle                                                                                      | macd                   | signal                 | hist
    ${{ close: 81, open: 81, high: 82.96289647361662, low: 79.03710352638338, volume: 403 }}    | ${null}                | ${null}                | ${null}
    ${{ close: 24, open: 81, high: 83.85720988022568, low: 21.142790119774318, volume: 814 }}   | ${null}                | ${null}                | ${null}
    ${{ close: 75, open: 24, high: 76.94326596315126, low: 22.056734036848734, volume: 1064 }}  | ${null}                | ${null}                | ${null}
    ${{ close: 21, open: 75, high: 79.67167346434113, low: 16.328326535658874, volume: 330 }}   | ${null}                | ${null}                | ${null}
    ${{ close: 34, open: 21, high: 34.711649023641215, low: 20.28835097635878, volume: 964 }}   | ${null}                | ${null}                | ${null}
    ${{ close: 25, open: 34, high: 36.18138133787512, low: 22.818618662124877, volume: 214 }}   | ${null}                | ${null}                | ${null}
    ${{ close: 72, open: 25, high: 73.33035016836122, low: 23.669649831638775, volume: 860 }}   | ${null}                | ${null}                | ${null}
    ${{ close: 92, open: 72, high: 94.97523624952838, low: 69.02476375047162, volume: 486 }}    | ${null}                | ${null}                | ${null}
    ${{ close: 99, open: 92, high: 101.5127586628106, low: 89.4872413371894, volume: 647 }}     | ${null}                | ${null}                | ${null}
    ${{ close: 2, open: 99, high: 99.0804764241746, low: 1.9195235758253941, volume: 396 }}     | ${null}                | ${null}                | ${null}
    ${{ close: 86, open: 2, high: 86.08306699694582, low: 1.916933003054178, volume: 252 }}     | ${null}                | ${null}                | ${null}
    ${{ close: 80, open: 86, high: 87.6552826540483, low: 78.3447173459517, volume: 299 }}      | ${null}                | ${null}                | ${null}
    ${{ close: 76, open: 80, high: 80.75068906338092, low: 75.24931093661908, volume: 469 }}    | ${null}                | ${null}                | ${null}
    ${{ close: 8, open: 76, high: 77.2154050332975, low: 6.784594966702496, volume: 605 }}      | ${-6.882564102564103}  | ${4.105811965811964}   | ${-10.988376068376066}
    ${{ close: 87, open: 8, high: 90.4594244098795, low: 4.540575590120497, volume: 261 }}      | ${4.39906114398422}    | ${4.252436554898091}   | ${0.1466245890861284}
    ${{ close: 75, open: 87, high: 91.6843769949034, low: 70.3156230050966, volume: 926 }}      | ${6.902097891063569}   | ${5.57726722298083}    | ${1.3248306680827389}
    ${{ close: 32, open: 75, high: 77.42509022428217, low: 29.57490977571783, volume: 544 }}    | ${-2.836489476792366}  | ${1.3703888730942326}  | ${-4.2068783498865985}
    ${{ close: 65, open: 32, high: 66.96254158787707, low: 30.037458412122934, volume: 819 }}   | ${0.5169347504064632}  | ${0.9436618117503479}  | ${-0.4267270613438847}
    ${{ close: 41, open: 65, high: 69.41431179251751, low: 36.58568820748249, volume: 1012 }}   | ${-3.720061241963762}  | ${-1.388199715106707}  | ${-2.3318615268570553}
    ${{ close: 9, open: 41, high: 43.081607806555546, low: 6.918392193444454, volume: 736 }}    | ${-13.519147746277028} | ${-7.453673730691868}  | ${-6.06547401558516}
    ${{ close: 13, open: 9, high: 15.19184083967761, low: 6.808159160322391, volume: 971 }}     | ${-16.67750564869595}  | ${-12.065589689693908} | ${-4.61191595900204}
    ${{ close: 26, open: 13, high: 28.498919258834377, low: 10.501080741165623, volume: 1098 }} | ${-14.05467162077349}  | ${-13.0601306552337}   | ${-0.994540965539791}
    ${{ close: 56, open: 26, high: 59.7249059948739, low: 22.2750940051261, volume: 379 }}      | ${-4.473560706857569}  | ${-8.766845681045634}  | ${4.293284974188065}
    ${{ close: 28, open: 56, high: 58.44863123776439, low: 25.551368762235615, volume: 117 }}   | ${-6.226316045524406}  | ${-7.49658086328502}   | ${1.270264817760614}
    ${{ close: 65, open: 28, high: 66.775319062114, low: 26.224680937886014, volume: 1041 }}    | ${2.3746737699539366}  | ${-2.5609535466655418} | ${4.935627316619478}
    ${{ close: 58, open: 65, high: 68.65939501847261, low: 54.340604981527385, volume: 510 }}   | ${4.872119444276542}   | ${1.1555829488055003}  | ${3.716536495471042}
    ${{ close: 17, open: 58, high: 60.01918882495998, low: 14.980811175040019, volume: 878 }}   | ${-4.252077025330536}  | ${-1.548247038262518}  | ${-2.703829987068018}
    ${{ close: 90, open: 17, high: 93.37632122668938, low: 13.623678773310617, volume: 150 }}   | ${9.346535660889295}   | ${3.8991443113133886}  | ${5.447391349575906}
    ${{ close: 87, open: 90, high: 91.79876207396401, low: 85.20123792603599, volume: 914 }}    | ${14.936813753223099}  | ${9.417979032268244}   | ${5.518834720954855}
    ${{ close: 86, open: 87, high: 90.67917429835809, low: 82.32082570164191, volume: 582 }}    | ${16.609612553748065}  | ${13.013795793008153}  | ${3.595816760739911}
    ${{ close: 99, open: 86, high: 103.90666224637769, low: 81.09333775362231, volume: 804 }}   | ${19.636749633783936}  | ${16.325272713396046}  | ${3.3114769203878893}
    ${{ close: 3, open: 99, high: 100.63598126886475, low: 1.3640187311352432, volume: 436 }}   | ${-3.665580749199947}  | ${6.32984598209805}    | ${-9.995426731297997}
    ${{ close: 70, open: 3, high: 74.01339408473842, low: -1.0133940847384295, volume: 747 }}   | ${1.2218872563128542}  | ${3.775866619205452}   | ${-2.5539793628925977}
    ${{ close: 1, open: 70, high: 70.62974231530183, low: 0.37025768469818, volume: 722 }}      | ${-13.35659127973836}  | ${-4.790362330266454}  | ${-8.566228949471906}
    ${{ close: 27, open: 1, high: 30.879348918826008, low: -2.879348918826009, volume: 221 }}   | ${-13.536028611595846} | ${-9.16319547093115}   | ${-4.372833140664696}
    ${{ close: 9, open: 27, high: 29.207668220474442, low: 6.792331779525556, volume: 148 }}    | ${-17.224910419363752} | ${-13.194052945147451} | ${-4.030857474216301}
    ${{ close: 92, open: 9, high: 96.46225023362183, low: 4.5377497663781705, volume: 331 }}    | ${2.393036380961078}   | ${-5.4005082820931865} | ${7.793544663054265}
    ${{ close: 68, open: 92, high: 94.82774764949542, low: 65.17225235050458, volume: 338 }}    | ${6.297960979220697}   | ${0.4487263485637554}  | ${5.849234630656942}
    ${{ close: 9, open: 68, high: 69.94866467256739, low: 7.051335327432617, volume: 823 }}     | ${-6.630182592691845}  | ${-3.090728122064045}  | ${-3.5394544706278004}
  `(
    'should return { macd: $macd, signal: $signal, hist: $hist } when candle close to $candle.close',
    ({ candle, macd, signal, hist }) => {
      macdIndicator.onNewCandle(candle);
      const { macd: macdResult, signal: signalResult, hist: histResult } = macdIndicator.getResult();
      expect(macdResult).toBeCloseTo(macd, 13);
      expect(signalResult).toBeCloseTo(signal, 13);
      expect(histResult).toBeCloseTo(hist, 13);
    },
  );
});

//
