import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { ExperienceService } from './experience.service';

export const experienceInterceptor: HttpInterceptorFn = (req, next) => {
  const experienceService = inject(ExperienceService);
  const cloned = req.clone({
    setHeaders: { 'X-Experience': experienceService.current }
  });
  return next(cloned);
};
