// Cash in/out must reach the ledger so book cash equals drawer cash. Until the accountant gives
// the real accounts (petty expenses, owner drawings, bank deposits…), they post to a suspense account
// that the accountant reclassifies. A non-zero suspense balance is a to-do for the accountant, not an error.
export const sql = `
INSERT INTO accounts (code, name_ar, name_en, type) VALUES
  ('2900', 'حساب معلق - حركات نقدية للتصنيف', 'Suspense - cash movements to classify', 'liability');
`;
