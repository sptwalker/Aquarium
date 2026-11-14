import type { Quality } from './config';

export class Hud {
  private hint = document.getElementById('hint')!;
  private food = document.getElementById('food')!;
  private buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#panel button'));

  constructor(onQuality: (q: Quality) => void) {
    for (const b of this.buttons) {
      b.addEventListener('click', () => {
        const q = b.dataset.q as Quality;
        onQuality(q);
        for (const o of this.buttons) o.classList.toggle('on', o === b);
      });
    }
    this.setQuality('high');
    setTimeout(() => this.hint.classList.add('fade'), 9000);
  }

  setQuality(q: Quality) {
    for (const b of this.buttons) b.classList.toggle('on', b.dataset.q === q);
  }

  setFood(n: number) {
    this.food.textContent = `🍤 ${n}`;
  }
}
