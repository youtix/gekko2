import { ConvLayer } from '../layer/conv/convLayer';
import { DropoutLayer } from '../layer/dropout/dropoutLayer';
import { FullyConnLayer } from '../layer/fullyConn/fullyConnLayer';
import { InputLayer } from '../layer/input/inputLayer';
import { LRNLayer } from '../layer/lrn/lrnLayer';
import { MaxoutLayer } from '../layer/maxout/maxoutLayer';
import { PoolLayer } from '../layer/pool/poolLayer';
import { QuadTransformLayer } from '../layer/quadTransform/quadTransformLayer';
import { RegressionLayer } from '../layer/regression/regressionLayer';
import { ReluLayer } from '../layer/relu/reluLayer';
import { SigmoidLayer } from '../layer/sigmoid/sigmoidLayer';
import { SoftmaxLayer } from '../layer/softmax/softmaxLayer';
import { SVMLayer } from '../layer/svm/svmLayer';
import { TanhLayer } from '../layer/tanh/tanhLayer';

export const MAP_TYPE_TO_LAYER = {
  conv: ConvLayer,
  dropout: DropoutLayer,
  fc: FullyConnLayer,
  input: InputLayer,
  lrn: LRNLayer,
  maxout: MaxoutLayer,
  pool: PoolLayer,
  quadtransform: QuadTransformLayer,
  regression: RegressionLayer,
  relu: ReluLayer,
  sigmoid: SigmoidLayer,
  softmax: SoftmaxLayer,
  svm: SVMLayer,
  tanh: TanhLayer,
} as const;
