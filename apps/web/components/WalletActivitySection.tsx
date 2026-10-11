import Link from "next/link";
import { RiskLine } from "./RiskLine";
import { WalletActivityCheck } from "./WalletActivityCheck";
import { chainIdFromName, chainLabel } from "@/lib/chains/config";
import { walletActivity as copy } from "@/lib/copy";
import type { ProjectDetail } from "@/lib/view";
import { shortAddress, type WalletItem } from "@/lib/wallets";

/**
 * The project page's wallet activity block. `wallets` is null for a signed-out visitor (nothing is shown).
 * - Project without chains: nothing here (the page already says "Chain belum diketahui").
 * - Supported chain, no wallets yet: a prompt linking to /wallets.
 * - Supported chain: one check per wallet, with the risk badge and official checker link repeated beside them.
 * - Unsupported chain: "Chain ini belum didukung." for users with wallets.
 */
export function WalletActivitySection({ project, wallets }: { project: ProjectDetail; wallets: WalletItem[] | null }) {
  if (wallets === null || project.chains.length === 0) return null;
  const chain = project.chains.find((c) => chainIdFromName(c) !== null);
  const chainId = chain === undefined ? null : chainIdFromName(chain);
  if (wallets.length === 0 && chainId === null) return null;

  return (
    <section aria-labelledby="wallet-activity-heading">
      <h2 id="wallet-activity-heading">{copy.heading}</h2>
      {chain === undefined || chainId === null ? (
        <p>{copy.chainNotSupported}</p>
      ) : wallets.length === 0 ? (
        <p>
          <Link href="/wallets">{copy.addWallet}</Link>
        </p>
      ) : (
        <>
          <RiskLine level={project.risk?.level ?? project.riskLevel} links={project.links} testId="wallet-risk-line" />
          {wallets.map((w) => (
            <WalletActivityCheck
              key={w.id}
              walletId={w.id}
              walletName={w.label ?? shortAddress(w.address)}
              chain={chain}
              chainLabel={chainLabel(chainId)}
            />
          ))}
        </>
      )}
    </section>
  );
}
