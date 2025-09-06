export class InputLayer {
  out_sx;
  out_sy;
  out_depth;
  layer_type;

  constructor(opt = {}) {
    // this is a bit silly but lets allow people to specify either ins or outs
    this.out_sx = typeof opt.out_sx !== 'undefined' ? opt.out_sx : opt.in_sx;
    this.out_sy = typeof opt.out_sy !== 'undefined' ? opt.out_sy : opt.in_sy;
    this.out_depth = typeof opt.out_depth !== 'undefined' ? opt.out_depth : opt.in_depth;
    this.layer_type = 'input';
  }

  forward(V, is_training) {
    this.in_act = V;
    this.out_act = V;
    return this.out_act; // dummy identity function for now
  }

  backward() {}

  getParamsAndGrads() {
    return [];
  }

  toJSON() {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
    };
  }

  fromJSON(json) {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
  }
}
