const BASE_URL = process.env.BILL_BASE_URL || "https://bill.racorecloud.com";

const accessKey = process.env.BILL_ACCESS_KEY;
const secretKey = process.env.BILL_SECRET_KEY;
const billCycleArg = process.argv[2] || process.env.BILL_CYCLE || "202606";
const channel = process.env.BILL_CHANNEL || "aws";

if (!accessKey || !secretKey) {
  console.error("Missing BILL_ACCESS_KEY or BILL_SECRET_KEY environment variables.");
  process.exit(1);
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      "X-Access-Key": accessKey,
      "X-Secret-Key": secretKey,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function indexBillRowsByAccount(rows) {
  return new Map(rows.map((row) => [String(row.account), row]));
}

function buildTenantBillSummary(tenants, billRows) {
  const rowsByAccount = indexBillRowsByAccount(billRows);

  return tenants.map((tenant) => {
    const matchedBills = (tenant.usage_account || [])
      .map((account) => rowsByAccount.get(String(account)))
      .filter(Boolean);

    const payableAmount = matchedBills.reduce(
      (sum, row) => sum + Number(row.payable_amount || 0),
      0
    );
    const usageQuantity = matchedBills.reduce(
      (sum, row) => sum + Number(row.usage_quantity || 0),
      0
    );

    return {
      tenant_name: tenant.tenant_name,
      sc_name: tenant.sc_name,
      usage_account: tenant.usage_account || [],
      matched_account_count: matchedBills.length,
      bill_summary: {
        bill_cycle: billCycleArg,
        channel,
        currency: matchedBills[0]?.currency || null,
        payable_amount: Number(payableAmount.toFixed(6)),
        usage_quantity: Number(usageQuantity.toFixed(6)),
      },
      matched_accounts: matchedBills,
    };
  });
}

const tenantsResponse = await requestJson("/billapi/v1/bill/tenants");
const billResponse = await requestJson("/billapi/v1/bill/query", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    bill_cycle: [billCycleArg],
    channel,
    group_by: ["account"],
  }),
});

const tenantSummaries = buildTenantBillSummary(
  tenantsResponse.data || [],
  billResponse.data || []
);

console.log(
  JSON.stringify(
    {
      tenants_query: tenantsResponse,
      bill_query: billResponse.query,
      tenant_bill_link: tenantSummaries,
    },
    null,
    2
  )
);