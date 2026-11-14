// Tank geometry constants (world units = ~10cm each).
// Tank geometry constants (world units = ~10cm each).
export const TANK = { hw: 4.0, hh: 4.6, hd: 2.0, wall: 0.06 };
export const WATER_Y = 4.05;
export const SAND_TOP = 0.62;
// Visible sand thickness at the front glass — a sand bed with depth, not a plane.
export const SAND_DEPTH = 0.95;

export type Quality = 'high' | 'mid' | 'low';

export const QUALITY: Record<
  Quality,
  { pixelRatio: number; samples: number; bloom: boolean; dof: boolean; godraySteps: number; dust: number; bubbles: number; causticSize: number }
> = {
  high: { pixelRatio: 2, samples: 4, bloom: true, dof: true, godraySteps: 12, dust: 900, bubbles: 120, causticSize: 512 },
  mid: { pixelRatio: 1.5, samples: 2, bloom: true, dof: false, godraySteps: 8, dust: 450, bubbles: 70, causticSize: 384 },
  low: { pixelRatio: 1, samples: 0, bloom: false, dof: false, godraySteps: 5, dust: 180, bubbles: 36, causticSize: 256 },
};
