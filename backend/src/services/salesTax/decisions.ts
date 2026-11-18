/**
 * Unconfirmed business and legal decisions.
 *
 * A preview may still show arithmetic. Nothing here authorizes posting a
 * live invoice, POS sale, or online order, and nothing here authorizes a
 * filing-ready export.
 */

export type DecisionDomain = 'sales_tax' | 'tobacco';

export type ComplianceDecision = {
  id: string;
  domain: DecisionDomain;
  question: string;
  blocksPosting: boolean;
  blocksFiling: boolean;
};

export const COMPLIANCE_DECISIONS: readonly ComplianceDecision[] = [
  {
    id: 'sales_tax_licence',
    domain: 'sales_tax',
    question: 'Does Express hold a Pennsylvania sales-tax licence, and which activities are wholesale-only versus retail?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'filing_frequency',
    domain: 'sales_tax',
    question: 'Which filing frequency has the Department assigned: monthly, quarterly, semi-annual, or accelerated monthly?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'reporting_basis',
    domain: 'sales_tax',
    question: 'Confirm the sales-tax reporting basis, including unpaid invoices and the business timezone.',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'places_of_business',
    domain: 'sales_tax',
    question: 'Which places of business originate sales, including any Philadelphia or Allegheny County location?',
    blocksPosting: true,
    blocksFiling: true,
  },
  {
    id: 'jurisdiction_sourcing',
    domain: 'sales_tax',
    question: 'Which location controls tax for counter sales, shipped sales, and out-of-state delivery? REV-717 does not authorize this system to pick an address automatically.',
    blocksPosting: true,
    blocksFiling: true,
  },
  {
    id: 'local_collection_duty',
    domain: 'sales_tax',
    question: 'When a selected address is in Philadelphia or Allegheny County, is Express required to collect the local tax, or is collection only voluntary because the sale did not originate there?',
    blocksPosting: true,
    blocksFiling: true,
  },
  {
    id: 'rounding_method',
    domain: 'sales_tax',
    question: 'Must Express use the REV-717 bracket table, or is cent rounding approved for its transactions?',
    blocksPosting: true,
    blocksFiling: true,
  },
  {
    id: 'missing_tax_assignment',
    domain: 'sales_tax',
    question: 'What should happen when a product has no TaxType: block the sale, or keep today\'s No Tax behavior?',
    blocksPosting: true,
    blocksFiling: true,
  },
  {
    id: 'exemption_practice',
    domain: 'sales_tax',
    question: 'Which REV-1220 exemption reasons are used, and where are the approved certificates stored?',
    blocksPosting: true,
    blocksFiling: true,
  },
  {
    id: 'freight_billing',
    domain: 'sales_tax',
    question: 'Which freight is billed by Express, and which is billed by a third party?',
    blocksPosting: true,
    blocksFiling: true,
  },
  {
    id: 'cigarette_wholesaler_licence',
    domain: 'tobacco',
    question: 'Does Express hold a Pennsylvania cigarette wholesaler licence?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'otp_wholesaler_licence',
    domain: 'tobacco',
    question: 'Does Express hold an OTP wholesaler licence?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'stamping_agent_licence',
    domain: 'tobacco',
    question: 'Does Express hold a cigarette stamping-agent licence, and does it affix stamps?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'msa_meaning',
    domain: 'tobacco',
    question: 'Does MSA mean DAS-95 NPM reporting, another stamping-agent schedule, or a different client report?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'npm_responsibility',
    domain: 'tobacco',
    question: 'Is Express the party required to file NPM reports?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'interstate_cigarette_sales',
    domain: 'tobacco',
    question: 'Does Express sell cigarettes across state lines?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'purchaser_classes',
    domain: 'tobacco',
    question: 'Which purchaser classes apply: retailer, wholesaler, vending, consumer, exempt, or out-of-state?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'counter_versus_shipped',
    domain: 'tobacco',
    question: 'How should counter sales and shipped sales map to REV-777 methods DT, CC, PP, and CT?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'cigarette_destination',
    domain: 'tobacco',
    question: 'Is cigarette destination the ship-to address or another legally defined location?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'cigarette_returns',
    domain: 'tobacco',
    question: 'How are customer returns and returns to suppliers recorded for cigarette quantities?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'excise_responsibility',
    domain: 'tobacco',
    question: 'Who is responsible for cigarette excise tax on products Express sells?',
    blocksPosting: false,
    blocksFiling: true,
  },
  {
    id: 'little_cigar_classification',
    domain: 'tobacco',
    question: 'Are Express little cigars reported on the cigarette return, the OTP return, or both?',
    blocksPosting: false,
    blocksFiling: true,
  },
];

export type TobaccoReportId = 'rev772' | 'rev777' | 'das95' | 'stamp_inventory' | 'otp';

export type TobaccoReportGate = {
  id: TobaccoReportId;
  enabled: false;
  filingReady: false;
  blockedBy: string;
};

/** Licence-dependent tobacco reports stay off until that licence is confirmed. */
export const TOBACCO_REPORT_GATES: readonly TobaccoReportGate[] = [
  { id: 'rev772', enabled: false, filingReady: false, blockedBy: 'cigarette_wholesaler_licence' },
  { id: 'rev777', enabled: false, filingReady: false, blockedBy: 'cigarette_wholesaler_licence' },
  { id: 'das95', enabled: false, filingReady: false, blockedBy: 'npm_responsibility' },
  { id: 'stamp_inventory', enabled: false, filingReady: false, blockedBy: 'stamping_agent_licence' },
  { id: 'otp', enabled: false, filingReady: false, blockedBy: 'otp_wholesaler_licence' },
];

export function salesTaxPostingBlockers(): ComplianceDecision[] {
  return COMPLIANCE_DECISIONS.filter((item) => item.domain === 'sales_tax' && item.blocksPosting);
}

export function salesTaxFilingBlockers(): ComplianceDecision[] {
  return COMPLIANCE_DECISIONS.filter((item) => item.domain === 'sales_tax' && item.blocksFiling);
}

export function salesTaxSetupStatus(): {
  postingAllowed: false;
  filingReady: false;
  postingBlockers: string[];
  filingBlockers: string[];
  tobaccoReports: readonly TobaccoReportGate[];
} {
  return {
    postingAllowed: false,
    filingReady: false,
    postingBlockers: salesTaxPostingBlockers().map((item) => item.id),
    filingBlockers: salesTaxFilingBlockers().map((item) => item.id),
    tobaccoReports: TOBACCO_REPORT_GATES,
  };
}
