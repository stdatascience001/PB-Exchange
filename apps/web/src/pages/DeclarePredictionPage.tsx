import React from 'react';
import { ShiftDto, UserSession } from '@pb/types';
import { LivePredictionPage } from './LivePredictionPage.js';

interface DeclarePredictionPageProps {
  shifts: ShiftDto[];
  user?: UserSession | null;
  onNavigate?: (page: string) => void;
}

export const DeclarePredictionPage: React.FC<DeclarePredictionPageProps> = (props) => (
  <LivePredictionPage {...props} isDeclareMode />
);
