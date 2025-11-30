// Main exports for loan calculation system
export * from './types';
export * from './loan-calculation.service';
export * from './reducing-balance-strategy';
export * from './flat-rate-strategy';
export * from './simple-interest-strategy';

// Re-export the singleton service instance for easy access
export { loanCalculationService as default } from './loan-calculation.service';
