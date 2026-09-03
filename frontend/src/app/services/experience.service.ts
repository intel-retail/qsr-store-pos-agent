import { Injectable, signal } from '@angular/core';

export type Experience = 'grocery' | 'cafe';

@Injectable({ providedIn: 'root' })
export class ExperienceService {
  private experienceSignal = signal<Experience>(
    (localStorage.getItem('experience') as Experience) || 'grocery'
  );

  get current(): Experience {
    return this.experienceSignal();
  }

  readonly experience = this.experienceSignal.asReadonly();

  switch(experience: Experience): void {
    this.experienceSignal.set(experience);
    localStorage.setItem('experience', experience);
  }
}
