export type DataScope = 'ALL' | 'SELF';

export interface OperatorShiftPermissionDto {
  id?: number;
  userId: number;
  shiftId: number;
  shiftDate: string;
  canAllow: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  dataScope: DataScope;
  expiresAt?: string | null;
}
