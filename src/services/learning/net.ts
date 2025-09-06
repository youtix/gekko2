// Net manages a set of layers

import { error } from '@services/logger';
import { ConvLayer } from './layer/convLayer';
import { DropoutLayer } from './layer/dropoutLayer';
import { FullyConnLayer } from './layer/fullyConLayer';
import { InputLayer } from './layer/inputLayer';
import { LocalResponseNormalizationLayer } from './layer/localResponseNormalizationLayer';
import { MaxoutLayer } from './layer/maxoutLayer';
import { PoolLayer } from './layer/poolLayer';
import { QuadTransformLayer } from './layer/quadTransformLayer';
import { RegressionLayer } from './layer/regressionLayer';
import { ReluLayer } from './layer/reluLayer';
import { SigmoidLayer } from './layer/sigmoidLayer';
import { SoftmaxLayer } from './layer/softmaxLayer';
import { SVMLayer } from './layer/svmLayer';
import { TanhLayer } from './layer/TanhLayer';

// For now constraints: Simple linear order of layers, first layer input last layer a cost layer
export class Net {
  layers;

  constructor() {
    this.layers = [];
  }

  // takes a list of layer definitions and creates the network layer objects
  makeLayers(defs) {
    // few checks for now
    if (defs.length < 2) {
      error('learning', 'ERROR! For now at least have input and softmax layers.');
    }
    if (defs[0].type !== 'input') {
      error('learning', 'ERROR! For now first layer should be input.');
    }
    // desugar syntactic for adding activations and dropouts
    const desugar = function () {
      const new_defs = [];
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
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
            const gs = def.group_size !== 'undefined' ? def.group_size : 2;
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
          this.layers.push(new FullyConnLayer(def));
          break;
        case 'lrn':
          this.layers.push(new LocalResponseNormalizationLayer(def));
          break;
        case 'dropout':
          this.layers.push(new DropoutLayer(def));
          break;
        case 'input':
          this.layers.push(new InputLayer(def));
          break;
        case 'softmax':
          this.layers.push(new SoftmaxLayer(def));
          break;
        case 'regression':
          this.layers.push(new RegressionLayer(def));
          break;
        case 'conv':
          this.layers.push(new ConvLayer(def));
          break;
        case 'pool':
          this.layers.push(new PoolLayer(def));
          break;
        case 'relu':
          this.layers.push(new ReluLayer(def));
          break;
        case 'sigmoid':
          this.layers.push(new SigmoidLayer(def));
          break;
        case 'tanh':
          this.layers.push(new TanhLayer(def));
          break;
        case 'maxout':
          this.layers.push(new MaxoutLayer(def));
          break;
        case 'quadtransform':
          this.layers.push(new QuadTransformLayer(def));
          break;
        case 'svm':
          this.layers.push(new SVMLayer(def));
          break;
        default:
          error('learning', 'ERROR: UNRECOGNIZED LAYER TYPE!');
      }
    }
  }
  // forward prop the network. A trainer will pass in is_training = true
  forward(V, is_training) {
    if (typeof is_training === 'undefined') is_training = false;
    let act = this.layers[0].forward(V, is_training);
    for (let i = 1; i < this.layers.length; i++) {
      act = this.layers[i].forward(act, is_training);
    }
    return act;
  }
  // backprop: compute gradients wrt all parameters
  backward(y) {
    const N = this.layers.length;
    const loss = this.layers[N - 1].backward(y); // last layer assumed softmax
    for (let i = N - 2; i >= 0; i--) {
      // first layer assumed input
      this.layers[i].backward();
    }
    return loss;
  }
  getParamsAndGrads() {
    // accumulate parameters and gradients for the entire network
    const response = [];
    for (let i = 0; i < this.layers.length; i++) {
      const layer_reponse = this.layers[i].getParamsAndGrads();
      for (let j = 0; j < layer_reponse.length; j++) {
        response.push(layer_reponse[j]);
      }
    }
    return response;
  }
  getPrediction() {
    const S = this.layers[this.layers.length - 1]; // softmax layer
    const p = S.out_act.w;
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
  toJSON() {
    const json = {
      layers: [],
    };
    for (let i = 0; i < this.layers.length; i++) {
      json.layers.push(this.layers[i].toJSON());
    }
    return json;
  }
  fromJSON(json) {
    this.layers = [];
    for (let i = 0; i < json.layers.length; i++) {
      const Lj = json.layers[i];
      const t = Lj.layer_type;
      let L;
      if (t === 'input') {
        L = new InputLayer();
      }
      if (t === 'relu') {
        L = new ReluLayer();
      }
      if (t === 'sigmoid') {
        L = new SigmoidLayer();
      }
      if (t === 'tanh') {
        L = new TanhLayer();
      }
      if (t === 'dropout') {
        L = new DropoutLayer();
      }
      if (t === 'conv') {
        L = new ConvLayer();
      }
      if (t === 'pool') {
        L = new PoolLayer();
      }
      if (t === 'lrn') {
        L = new LocalResponseNormalizationLayer();
      }
      if (t === 'softmax') {
        L = new SoftmaxLayer();
      }
      if (t === 'regression') {
        L = new RegressionLayer();
      }
      if (t === 'fc') {
        L = new FullyConnLayer();
      }
      if (t === 'maxout') {
        L = new MaxoutLayer();
      }
      if (t === 'quadtransform') {
        L = new QuadTransformLayer();
      }
      if (t === 'svm') {
        L = new SVMLayer();
      }
      L?.fromJSON(Lj);
      this.layers.push(L);
    }
  }
}
