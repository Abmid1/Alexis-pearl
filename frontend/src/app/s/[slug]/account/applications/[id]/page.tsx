import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite } from '@/lib/publicApi';
import ApplicationDetail from '@/components/site/ApplicationDetail';

export const metadata: Metadata = { title: 'Application', robots: { index: false } };

export default async function ApplicationPage({ params }: { params: { slug: string; id: string } }) {
  const site = await getSite(params.slug);
  if (!site || !/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  return (
    <div className="s-wrap" style={{ paddingBottom: 56 }}>
      <div className="s-page-head" style={{ marginBottom: 18 }}><h1>Your application</h1></div>
      <ApplicationDetail slug={site.company.slug} companyName={site.company.name} id={params.id} />
    </div>
  );
}
