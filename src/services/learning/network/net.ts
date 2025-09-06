import { LayerDef } from '@models/layer.types';
import { error } from '@services/logger';
import { isNumber } from 'lodash-es';
import { ConvLayer } from '../layer/conv/convLayer';
import type { ParamGrad } from '../layer/conv/convLayer.types';
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
import { LayerInstance, LayerJSON, RegressionTarget } from '../learning.types';
import { Vol } from '../volume/vol';
import { MAP_TYPE_TO_LAYER } from './net.const';

/**
 * Net manages a set of layers
 * For now constraints: Simple linear order of layers, first layer input last layer a cost layer
 */
export class Net {
  layers: LayerInstance[];

  constructor() {
    this.layers = [];
  }

  // takes a list of layer definitions and creates the network layer objects
  makeLayers(defs: LayerDef[]): void {
    // few checks for now
    if (defs.length < 2) {
      error('learning', 'ERROR! For now at least have input and softmax layers.');
    }
    if (defs[0].type !== 'input') {
      error('learning', 'ERROR! For now first layer should be input.');
    }
    // desugar syntactic for adding activations and dropouts
    const desugar = function (defsIn: LayerDef[]): LayerDef[] {
      const new_defs: LayerDef[] = [];
      for (let i = 0; i < defsIn.length; i++) {
        const def = { ...defsIn[i] };
        if (def.type === 'softmax' || def.type === 'svm') {
          // add an fc layer here, there is no reason the user should
          // have to worry about this and we almost always want to
          new_defs.push({ type: 'fc', num_neurons: def.num_classes });
        }
        if (def.type === 'regression') {
          // add an fc layer here, there is no reason the user should
          // have to worry about this and we almost always want to
          new_defs.push({ type: 'fc', num_neurons: def.num_neurons });
        }
        if ((def.type === 'fc' || def.type === 'conv') && typeof def.bias_pref === 'undefined') {
          def.bias_pref = 0.0;
          if (typeof def.activation !== 'undefined' && def.activation === 'relu') {
            def.bias_pref = 0.1; // relus like a bit of positive bias to get gradients early
            // otherwise it's technically possible that a relu unit will never turn on (by chance)
            // and will never get any gradient and never contribute any computation. Dead relu.
          }
        }
        if (typeof def.tensor !== 'undefined') {
          // apply quadratic transform so that the upcoming multiply will include
          // quadratic terms, equivalent to doing a tensor product
          if (def.tensor) {
            new_defs.push({ type: 'quadtransform' });
          }
        }
        new_defs.push(def);
        if (typeof def.activation !== 'undefined') {
          if (def.activation === 'relu') {
            new_defs.push({ type: 'relu' });
          } else if (def.activation === 'sigmoid') {
            new_defs.push({ type: 'sigmoid' });
          } else if (def.activation === 'tanh') {
            new_defs.push({ type: 'tanh' });
          } else if (def.activation === 'maxout') {
            // create maxout activation, and pass along group size, if provided
            const gs = typeof def.group_size !== 'undefined' ? def.group_size : 2;
            new_defs.push({ type: 'maxout', group_size: gs });
          } else {
            error('learning', 'ERROR unsupported activation ' + def.activation);
          }
        }
        if (typeof def.drop_prob !== 'undefined' && def.type !== 'dropout') {
          new_defs.push({ type: 'dropout', drop_prob: def.drop_prob });
        }
      }
      return new_defs;
    };
    defs = desugar(defs);
    // create the layers
    this.layers = [];
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      if (i > 0) {
        const prev = this.layers[i - 1];
        def.in_sx = prev.out_sx;
        def.in_sy = prev.out_sy;
        def.in_depth = prev.out_depth;
      }
      switch (def.type) {
        case 'fc':
          // @ts-expect-error later
          this.layers.push(new FullyConnLayer(def));
          break;
        case 'lrn':
          // @ts-expect-error later
          this.layers.push(new LRNLayer(def));
          break;
        case 'dropout':
          // @ts-expect-error later
          this.layers.push(new DropoutLayer(def));
          break;
        case 'input':
          this.layers.push(new InputLayer(def));
          break;
        case 'softmax':
          // @ts-expect-error later
          this.layers.push(new SoftmaxLayer(def));
          break;
        case 'regression':
          // @ts-expect-error later
          this.layers.push(new RegressionLayer(def));
          break;
        case 'conv':
          // @ts-expect-error later
          this.layers.push(new ConvLayer(def));
          break;
        case 'pool':
          // @ts-expect-error later
          this.layers.push(new PoolLayer(def));
          break;
        case 'relu':
          // @ts-expect-error later
          this.layers.push(new ReluLayer(def));
          break;
        case 'sigmoid':
          // @ts-expect-error later
          this.layers.push(new SigmoidLayer(def));
          break;
        case 'tanh':
          // @ts-expect-error later
          this.layers.push(new TanhLayer(def));
          break;
        case 'maxout':
          // @ts-expect-error later
          this.layers.push(new MaxoutLayer(def));
          break;
        case 'quadtransform':
          // @ts-expect-error later
          this.layers.push(new QuadTransformLayer(def));
          break;
        case 'svm':
          // @ts-expect-error later
          this.layers.push(new SVMLayer(def));
          break;
        default:
          error('learning', 'ERROR: UNRECOGNIZED LAYER TYPE!');
      }
    }
  }
  // forward prop the network. A trainer will pass in is_training = true
  forward(V: Vol, is_training = false): Vol {
    let act = this.layers[0].forward(V, is_training);
    for (let i = 1; i < this.layers.length; i++) {
      act = this.layers[i].forward(act, is_training);
    }
    return act;
  }
  // backprop: compute gradients wrt all parameters
  backward(y: number | RegressionTarget): number {
    const N = this.layers.length;
    const loss = this.outputLayerBackward(this.layers[N - 1], y);
    for (let i = N - 2; i >= 0; i--) {
      this.layers[i].backward();
    }
    return loss;
  }

  getParamsAndGrads(): ParamGrad[] {
    // accumulate parameters and gradients for the entire network
    const response: ParamGrad[] = [];
    for (let i = 0; i < this.layers.length; i++) {
      const layer_reponse = this.layers[i].getParamsAndGrads() as ParamGrad[];
      for (let j = 0; j < layer_reponse.length; j++) {
        response.push(layer_reponse[j]);
      }
    }
    return response;
  }

  getPrediction(): number {
    const S = this.layers[this.layers.length - 1]; // softmax layer
    const p = (S.out_act as Vol).w;
    let maxv = p[0];
    let maxi = 0;
    for (let i = 1; i < p.length; i++) {
      if (p[i] > maxv) {
        maxv = p[i];
        maxi = i;
      }
    }
    return maxi;
  }

  toJSON(): { layers: LayerJSON[] } {
    const json: { layers: LayerJSON[] } = {
      layers: [],
    };
    for (let i = 0; i < this.layers.length; i++) {
      json.layers.push(this.layers[i].toJSON());
    }
    return json;
  }

  fromJSON(json: { layers: LayerInstance[] }): void {
    this.layers = [];
    for (let i = 0; i < json.layers.length; i++) {
      const Lj = json.layers[i];
      const t = Lj.layer_type;
      const L = new MAP_TYPE_TO_LAYER[t]();
      L?.fromJSON(Lj);
      if (L) this.layers.push(L);
    }
  }

  private outputLayerBackward(outputLayer: LayerInstance, y: number | RegressionTarget) {
    if (outputLayer instanceof RegressionLayer && !isNumber(y)) {
      return outputLayer.backward(y);
    } else if ((outputLayer instanceof SoftmaxLayer || outputLayer instanceof SVMLayer) && isNumber(y)) {
      return outputLayer.backward(y);
    }
    throw new Error('Wrong parameter use in Net.backward() when using output layer');
  }
}
