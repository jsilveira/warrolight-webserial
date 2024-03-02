import LightProgram from "./../base-programs/LightProgram";

import ColorUtils from "../utils/ColorUtils";

export default class Radial extends LightProgram {
  drawFrame(leds) {
    const elapsed = this.timeInMs / 1000;

    this.extraTime = (this.extraTime || 0) + Math.random() * 10;

    for (let i = 0; i < this.numberOfLeds; i++) {
      let geometry = this.geometry;

      const dx = geometry.x[i] - geometry.width / 2 - this.config.centerX;
      const dy = geometry.y[i] - geometry.height + this.config.centerY + 18; // 18 is the offset

      const distance = (Math.sqrt(dx * dx + dy * dy) * 255) / (300 * this.config.escala);

      const v = Math.pow(
        Math.max(0, Math.sin(distance + elapsed * this.config.velocidad)),
        this.config.power
      );

      leds[i] = ColorUtils.HSVtoRGB((distance / 5 + this.extraTime / 1000) % 1, 1, v);
    }
  }

  getDebugHelpers() {
    let {centerX, centerY, escala} = this.config;

    // Helpers coordinates are already centered
    let y = centerY + 18 - this.geometry.height/2;
    let x = centerX;
    let z = 0;

    return [
      {type: 'sphere', x, y, z, r: escala*Math.PI},
      {type: 'sphere', x, y, z, r: 1}
    ];
  }

  // Override and extend config Schema
  static configSchema() {
    let res = super.configSchema();
    res.escala = { type: Number, min: 0.1, max: 100, step: 0.1, default: 10 };
    res.velocidad = { type: Number, min: -50, max: 50, step: 0.1, default: -5 };
    res.centerY = { type: Number, min: -50, max: 50, step: 0.1, default: 0 };
    res.centerX = { type: Number, min: -100, max: 100, step: 0.1, default: 0 };
    res.power = { type: Number, min: 0, max: 10, step: 0.1, default: 1 };
    res.colorMap = { type: "gradient", default: "" };

    return res;
  }
};
