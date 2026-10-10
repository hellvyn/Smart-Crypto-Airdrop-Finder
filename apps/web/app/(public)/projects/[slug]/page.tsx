import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { StaleBanner } from "@/components/StaleBanner";
import { WalletActivityCheck } from "@/components/WalletActivityCheck";
import { WatchButton } from "@/components/WatchButton";
import { getUser } from "@/lib/auth";
import { chainIdFromName, chainLabel } from "@/lib/chains/config";
import { getLastSuccessfulRunAt, getProjectDetail } from "@/lib/queries";
import { createServerClient } from "@/lib/supabase/server";
import { isWatching } from "@/lib/watchlist";
import { listWallets, shortAddress } from "@/lib/wallets";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await createServerClient();
  const [project, lastRunAt] = await Promise.all([getProjectDetail(db, slug), getLastSuccessfulRunAt(db)]);
  if (!project) notFound();
  // The page is public; only a signed-in user gets the watch state (null = signed out).
  const user = await getUser();
  const watching = user ? await isWatching(db, project.id) : null;
  // Wallet activity is for signed-in users with at least one wallet, on a project whose chain we can look up.
  const wallets = user ? await listWallets(db) : [];
  const chain = project.chains.find((c) => chainIdFromName(c) !== null);
  const chainId = chain === undefined ? null : chainIdFromName(chain);
  return (
    <>
      <p>
        <Link href="/">&larr; All airdrops</Link>
      </p>
      <StaleBanner lastRunAt={lastRunAt} now={new Date()} />
      <WatchButton projectId={project.id} slug={project.slug} watching={watching} />
      <ProjectDetailView project={project} />
      {wallets.length > 0 && project.chains.length > 0 ? (
        <section aria-labelledby="wallet-activity-heading">
          <h2 id="wallet-activity-heading">Wallet activity</h2>
          {chain !== undefined && chainId !== null ? (
            wallets.map((w) => (
              <WalletActivityCheck
                key={w.id}
                walletId={w.id}
                walletName={w.label ?? shortAddress(w.address)}
                chain={chain}
                chainLabel={chainLabel(chainId)}
              />
            ))
          ) : (
            <p>Chain not supported yet.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
