import { LayerType } from '@models/layer.types';
import { ConvLayerJSON, ParamGrad } from './layer/conv/convLayer.types';
import { DropoutJSON } from './layer/dropout/dropoutLayer.types';
import { FullyConnLayerJSON } from './layer/fullyConn/fullyConnLayer.types';
import { InputLayerJSON } from './layer/input/inputLayer.types';
import { LRNLayerJSON } from './layer/lrn/lrnLayer.types';
import { MaxoutLayerJSON } from './layer/maxout/maxoutLayer.types';
import { PoolLayerJSON } from './layer/pool/poolLayer.types';
import { QuadTransformLayerJSON } from './layer/quadTransform/quadTransformLayer.types';
import { RegressionLayerJSON } from './layer/regression/regressionLayer.types';
import { ReluLayerJSON } from './layer/relu/reluLayer.types';
import { SigmoidLayerJSON } from './layer/sigmoid/sigmoidLayer.types';
import { SoftmaxLayerJSON } from './layer/softmax/softmaxLayer.types';
import { SVMLayerJSON } from './layer/svm/svmLayer.types';
import { TanhLayerJSON } from './layer/tanh/tanhLayer.types';
import { Vol } from './volume/vol';

export type RegressionTarget = number[] | Float64Array | { dim: number; val: number };
export interface LayerInstance {
  layer_type: LayerType;
  out_sx: number;
  out_sy: number;
  out_depth: number;
  out_act?: Vol;
  forward: (V: Vol, is_training?: boolean) => Vol;
  backward: Backward;
  getParamsAndGrads: () => ParamGrad[];
  toJSON: ToJSON;
  fromJSON: FromJSON;
}

export type LayerJSON =
  | ConvLayerJSON
  | DropoutJSON
  | FullyConnLayerJSON
  | InputLayerJSON
  | LRNLayerJSON
  | LRNLayerJSON
  | MaxoutLayerJSON
  | PoolLayerJSON
  | QuadTransformLayerJSON
  | RegressionLayerJSON
  | ReluLayerJSON
  | SigmoidLayerJSON
  | SoftmaxLayerJSON
  | SVMLayerJSON
  | TanhLayerJSON;
type Backward = (() => void) | ((y: number) => number) | ((y: RegressionTarget) => number);
type ToJSON =
  | (() => ConvLayerJSON)
  | (() => DropoutJSON)
  | (() => FullyConnLayerJSON)
  | (() => InputLayerJSON)
  | (() => LRNLayerJSON)
  | (() => MaxoutLayerJSON)
  | (() => PoolLayerJSON)
  | (() => QuadTransformLayerJSON)
  | (() => RegressionLayerJSON)
  | (() => ReluLayerJSON)
  | (() => SigmoidLayerJSON)
  | (() => SoftmaxLayerJSON)
  | (() => SVMLayerJSON)
  | (() => TanhLayerJSON);
type FromJSON =
  | ((json: ConvLayerJSON) => void)
  | ((json: DropoutJSON) => void)
  | ((json: FullyConnLayerJSON) => void)
  | ((json: InputLayerJSON) => void)
  | ((json: LRNLayerJSON) => void)
  | ((json: MaxoutLayerJSON) => void)
  | ((json: PoolLayerJSON) => void)
  | ((json: QuadTransformLayerJSON) => void)
  | ((json: RegressionLayerJSON) => void)
  | ((json: ReluLayerJSON) => void)
  | ((json: SigmoidLayerJSON) => void)
  | ((json: SoftmaxLayerJSON) => void)
  | ((json: SVMLayerJSON) => void)
  | ((json: TanhLayerJSON) => void);
