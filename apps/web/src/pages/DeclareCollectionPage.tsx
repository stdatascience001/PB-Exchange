import React from 'react';
import { ShiftDto } from '@pb/types';
import { CollectionPage } from './CollectionPage.js';

interface DeclareCollectionPageProps {
  shifts: ShiftDto[];
  activeShift: ShiftDto | null;
}

export const DeclareCollectionPage: React.FC<DeclareCollectionPageProps> = (props) => (
  <CollectionPage {...props} declareModeOnly />
);
