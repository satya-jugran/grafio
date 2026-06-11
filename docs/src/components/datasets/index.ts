import { Dataset } from './types';
import { socialNetworkDataset } from './social-network';
import { educationDataset } from './education';
import { healthcareDataset } from './healthcare';
import { ecommerceDataset } from './ecommerce';

export type { Dataset };
export const datasets: Dataset[] = [
  socialNetworkDataset,
  educationDataset,
  healthcareDataset,
  ecommerceDataset
];
