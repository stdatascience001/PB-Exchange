import React from 'react';
import { ShiftDto } from '@pb/types';
import { JantriPage } from './JantriPage.js';

interface DeclareJantriPageProps {
  shifts: ShiftDto[];
  activeShift: ShiftDto | null;
  onSelectShift: (shift: ShiftDto) => void;
}

export const DeclareJantriPage: React.FC<DeclareJantriPageProps> = (props) => (
  <JantriPage {...props} declareModeOnly />
);
