import type { FieldType } from '../api/types';
import type { IconName } from './icons';

/** Field palette. w/h are pixel sizes at zoom 1 on an 816px-wide page (as in the prototype). */
export const FIELD_DEFS: Record<FieldType, { label: string; icon: IconName; w: number; h: number }> = {
  signature: { label: 'Signature', icon: 'sign', w: 170, h: 52 },
  initial: { label: 'Initial', icon: 'sign', w: 72, h: 44 },
  stamp: { label: 'Stamp', icon: 'stamp', w: 110, h: 110 },
  dateSigned: { label: 'Date Signed', icon: 'cal', w: 120, h: 26 },
  name: { label: 'Name', icon: 'user', w: 170, h: 26 },
  email: { label: 'Email Address', icon: 'mail', w: 200, h: 26 },
  company: { label: 'Company', icon: 'co', w: 170, h: 26 },
  title: { label: 'Title', icon: 'title', w: 150, h: 26 },
  text: { label: 'Text', icon: 'text', w: 170, h: 26 },
  checkbox: { label: 'Checkbox', icon: 'cb', w: 20, h: 20 },
};
export const PALETTE: FieldType[][] = [['signature', 'initial', 'stamp', 'dateSigned'], ['name', 'email', 'company', 'title'], ['text', 'checkbox']];
export const IMAGE_FIELDS: FieldType[] = ['signature', 'initial', 'stamp'];
export const TEXT_INPUT_FIELDS: FieldType[] = ['text', 'company', 'title'];
/** Required by default when placed (prototype REQUIRED list). */
export const isRequiredByDefault = (t: FieldType) => IMAGE_FIELDS.includes(t);
export const isImageField = (t: FieldType) => IMAGE_FIELDS.includes(t);
export const hasValue = (v: string | null | undefined) => v !== undefined && v !== null && v !== '' && v !== 'false';
