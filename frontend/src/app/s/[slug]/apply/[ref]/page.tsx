import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite, getListing, idFromRef, propertyPath, fmtPrice } from '@/lib/publicApi';
import ApplyForm from '@/components/site/ApplyForm';
import { I } from '@/components/Icons';

export const metadata: Metadata = { title: 'Apply', robots: { index: false } };

export default async function Apply({ params }: { params: { slug: string; ref: string } }) {
  const id = idFromRef(params.ref);
  if (!id) notFound();
  const [site, data] = await Promise.all([getSite(params.slug), getListing(params.slug, id)]);
  if (!site || !data) notFound();
  const p = data.property;
  const open = ['available', 'under_offer'].includes(p.availability.code);
  return (
    <div className="s-wrap" style={{ paddingBottom: 56 }}>
      <nav className="s-crumbs" aria-label="Breadcrumb"><a href={propertyPath(site.company.slug, p)}><I name="chevronLeft" size={14} /> Back to listing</a></nav>
      <div className="s-page-head" style={{ marginBottom: 18, paddingTop: 0 }}>
        <h1>Apply for {p.title}</h1>
        <p>{fmtPrice(p)} · {p.availability.label}</p>
      </div>
      {open
        ? <ApplyForm slug={site.company.slug} companyName={site.company.name} propertyId={p.id} propertyTitle={p.title} kind={p.purpose === 'rent' ? 'rental' : 'purchase'} />
        : <div className="s-empty"><h2>Applications are closed</h2><p>This property is {p.availability.label.toLowerCase()}. You can still send the agency a message.</p><a className="s-btn s-btn-primary" href={propertyPath(site.company.slug, p)}>Back to listing</a></div>}
    </div>
  );
}
