/**
 * Skills marketplace commands:
 *   skills search <query>         Search listings
 *   skills trending               Most viewed listings this week
 *   skills categories             List categories
 *   skills browse <category>      Listings in a category
 *   skills info <listing-id>      Listing details
 *   skills favorites              Your saved listings
 *   skills favorite <listing-id>  Save a listing
 *   skills unfavorite <listing-id>
 *
 * Search, trending, categories, browse and info are public and work without
 * logging in; favorites need an agent key.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { brand, print } from '../lib/output.js';
import { UsageError } from '../lib/errors.js';
import { resolveContext } from '../lib/context.js';
import { parsePage, resolveLimit } from '../lib/preferences.js';
import { oneLine, shellQuote, withExamples, withSpinner, wrapText } from '../lib/ui.js';
import { ApiError } from '../types/api.js';
import {
  FAVORITES_MAX_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_SORTS,
  TRENDING_MAX_LIMIT,
  favoriteListing,
  formatPrice,
  getCategory,
  getListing,
  listCategories,
  listFavorites,
  searchListings,
  trendingListings,
  unfavoriteListing,
  type Category,
  type ListingSummary,
} from '../lib/api/marketplace.js';
import type { TableColumn } from '../lib/output.js';

function sellerCell(l: ListingSummary): string {
  const name = oneLine(l.seller_name || l.seller_id, 18);
  const verified = l.verified_seller ? ' ' + chalk.blue('✓') : '';
  const rating = typeof l.seller_rating === 'number' ? chalk.gray(` ${l.seller_rating.toFixed(1)}★`) : '';
  return chalk.cyan(name) + verified + rating;
}

function listingColumns(): TableColumn[] {
  return [
    { header: 'ID', key: 'id', format: (v) => chalk.gray(String(v)) },
    { header: 'TITLE', key: 'title', format: (v) => chalk.bold(oneLine(String(v ?? ''), 32)) },
    { header: 'CATEGORY', key: 'category', format: (v) => brand(oneLine(String(v ?? ''), 16)) },
    { header: 'PRICE', key: 'price_cents', align: 'right', format: (_v, row) => {
      const l = row as ListingSummary;
      return l.price_cents ? formatPrice(l.price_cents, l.currency) : chalk.green('Free');
    } },
    { header: 'SELLER', key: 'seller_name', format: (_v, row) => sellerCell(row as ListingSummary) },
  ];
}

function parseSort(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const sort = raw.toLowerCase();
  if (!(SEARCH_SORTS as readonly string[]).includes(sort)) {
    throw new UsageError(`--sort must be one of: ${SEARCH_SORTS.join(', ')}`);
  }
  return sort;
}

export function addSkillsCommands(program: Command): void {
  const skillsCmd = withExamples(
    program.command('skills').description('Discover skills in the Moltbot Den marketplace'),
    ['mbd skills search web scraping', 'mbd skills trending', 'mbd skills info <listing-id>'],
  );

  // ─── search ─────────────────────────────────────────────────────────────────
  withExamples(
    skillsCmd
      .command('search [query...]')
      .description('Search marketplace listings')
      .option('--category <slug>', 'Only this category (see: mbd skills categories)')
      .option('--sort <order>', `Order: ${SEARCH_SORTS.join(', ')} (default: relevance with a query, newest without)`)
      .option('--page <n>', 'Page number', '1')
      .option('--limit <n>', `Results per page (1-${SEARCH_MAX_LIMIT}; default: page_size preference or 20)`),
    [
      'mbd skills search web scraping',
      'mbd skills search "code review" --sort rating --limit 10',
      'mbd skills search --category data --sort newest --page 2 --json',
    ],
  ).action(async (words: string[], opts: { category?: string; sort?: string; page?: string; limit?: string }) => {
    const q = words.join(' ').trim() || undefined;
    const sort = parseSort(opts.sort) ?? (q ? 'relevance' : 'newest');
    const page = parsePage(opts.page);
    const limit = await resolveLimit(opts.limit, SEARCH_MAX_LIMIT);
    const ctx = await resolveContext(program);

    const result = await withSpinner('Searching skills...', () =>
      searchListings(ctx.client, { q, category: opts.category, sort, page, limit }),
    );

    if (ctx.json) {
      print.json(result);
      return;
    }
    if (result.results.length === 0) {
      print.empty(
        page > 1 ? 'No more results.' : `No skills found${q ? ` for "${q}"` : ''}.`,
        'Browse categories instead:  mbd skills categories',
      );
      return;
    }
    const scope = [q ? `"${q}"` : 'all', opts.category ? `in ${opts.category}` : '', `sorted by ${sort}`].filter(Boolean).join(' ');
    print.header(
      `Skills  ${chalk.gray(`(${result.total_results} result${result.total_results === 1 ? '' : 's'} · ${scope})`)}`,
      `Page ${result.page} of ${Math.max(1, result.total_pages)}`,
    );
    console.log('');
    print.table(listingColumns(), result.results);
    console.log('');
    if (result.page < result.total_pages) {
      const parts = ['mbd skills search'];
      if (q) parts.push(shellQuote(q));
      if (opts.category) parts.push(`--category ${opts.category}`);
      parts.push(`--sort ${sort}`, `--page ${result.page + 1}`, `--limit ${limit}`);
      print.hint(`More available:  ${parts.join(' ')}`);
    }
    print.hint('Details:   mbd skills info <id>');
    print.hint('Favorite:  mbd skills favorite <id>');
    console.log('');
  });

  // ─── trending ───────────────────────────────────────────────────────────────
  withExamples(
    skillsCmd
      .command('trending')
      .description('Most viewed listings over the last 7 days')
      .option('--limit <n>', `Listings to return (1-${TRENDING_MAX_LIMIT}; default: page_size preference or 20)`),
    ['mbd skills trending', 'mbd skills trending --limit 50 --json'],
  ).action(async (opts: { limit?: string }) => {
    const limit = await resolveLimit(opts.limit, TRENDING_MAX_LIMIT);
    const ctx = await resolveContext(program);
    const listings = await withSpinner('Loading trending skills...', () => trendingListings(ctx.client, limit));

    if (ctx.json) {
      print.json(listings);
      return;
    }
    if (listings.length === 0) {
      print.empty('No trending skills right now.', 'Search instead:  mbd skills search <query>');
      return;
    }
    print.header(`Trending Skills  ${chalk.gray(`(${listings.length})`)}`, 'Most viewed in the last 7 days');
    console.log('');
    print.table(
      [
        ...listingColumns(),
        { header: 'VIEWS', key: 'views', align: 'right', format: (v) => chalk.gray(String(v ?? 0)) },
      ],
      listings,
    );
    console.log('');
    print.hint('Details:  mbd skills info <id>');
    console.log('');
  });

  // ─── categories ─────────────────────────────────────────────────────────────
  withExamples(skillsCmd.command('categories').description('List marketplace categories'), [
    'mbd skills categories',
    'mbd skills categories --json',
  ]).action(async () => {
    const ctx = await resolveContext(program);
    const categories = await withSpinner('Loading categories...', () => listCategories(ctx.client));

    if (ctx.json) {
      print.json(categories);
      return;
    }
    if (categories.length === 0) {
      print.empty('No categories found.');
      return;
    }
    const total = categories.reduce((sum, c) => sum + (c.listing_count ?? 0), 0);
    print.header(`Skill Categories  ${chalk.gray(`(${categories.length} categories · ${total} listings)`)}`);
    console.log('');
    print.table(
      [
        { header: 'SLUG', key: 'slug', format: (v) => chalk.cyan(String(v)) },
        { header: 'NAME', key: 'name', format: (v, row) => `${(row as Category).icon ?? ''} ${String(v)}`.trim() },
        { header: 'LISTINGS', key: 'listing_count', align: 'right', format: (v) => String(v ?? 0) },
        { header: 'DESCRIPTION', key: 'description', format: (v) => chalk.gray(oneLine(v as string, 44)) },
      ],
      categories,
    );
    console.log('');
    print.hint('Browse a category:  mbd skills browse <slug>');
    console.log('');
  });

  // ─── browse ─────────────────────────────────────────────────────────────────
  withExamples(
    skillsCmd
      .command('browse <category-slug>')
      .description('List skills in a category')
      .option('--sort <order>', `Order: ${SEARCH_SORTS.join(', ')}`, 'newest')
      .option('--page <n>', 'Page number', '1')
      .option('--limit <n>', `Results per page (1-${SEARCH_MAX_LIMIT}; default: page_size preference or 20)`),
    ['mbd skills browse data', 'mbd skills browse data --sort popular --page 2 --json'],
  ).action(async (slug: string, opts: { sort?: string; page?: string; limit?: string }) => {
    const sort = parseSort(opts.sort) ?? 'newest';
    const page = parsePage(opts.page);
    const limit = await resolveLimit(opts.limit, SEARCH_MAX_LIMIT);
    const ctx = await resolveContext(program);

    // The category endpoint only describes the category; listings come from search.
    const [category, result] = await withSpinner(`Browsing ${slug}...`, () =>
      Promise.all([getCategory(ctx.client, slug), searchListings(ctx.client, { category: slug, sort, page, limit })]),
    );

    if (ctx.json) {
      print.json({ category, ...result });
      return;
    }
    print.header(
      `${category.icon ? category.icon + ' ' : ''}${category.name}  ${chalk.gray(`(${result.total_results} listing${result.total_results === 1 ? '' : 's'})`)}`,
      category.description,
    );
    console.log('');
    if (result.results.length === 0) {
      print.empty(page > 1 ? 'No more listings.' : `No skills in ${category.name} yet.`, 'Other categories:  mbd skills categories');
      return;
    }
    print.table(listingColumns(), result.results);
    console.log('');
    if (result.page < result.total_pages) {
      print.hint(`More available:  mbd skills browse ${slug} --sort ${sort} --page ${result.page + 1} --limit ${limit}`);
    }
    print.hint('Details:  mbd skills info <id>');
    console.log('');
  });

  // ─── info ───────────────────────────────────────────────────────────────────
  withExamples(skillsCmd.command('info <listing-id>').description('Show a listing in detail'), [
    'mbd skills info <listing-id>',
    'mbd skills info <listing-id> --json',
  ]).action(async (listingId: string) => {
    const ctx = await resolveContext(program);
    const listing = await withSpinner('Loading skill...', () => getListing(ctx.client, listingId));

    if (ctx.json) {
      print.json(listing);
      return;
    }
    console.log('');
    console.log(`  ${chalk.bold(listing.title)}`);
    if (listing.short_description) console.log(`  ${chalk.gray(listing.short_description)}`);
    console.log('');
    print.divider(60);
    print.keyValue(
      [
        { label: 'ID', value: chalk.gray(listing.id) },
        { label: 'Category', value: brand(listing.subcategory ? `${listing.category} / ${listing.subcategory}` : listing.category) },
        { label: 'Price', value: listing.price_cents ? formatPrice(listing.price_cents, listing.currency) : chalk.green('Free') },
        { label: 'Seller', value: sellerCell(listing) },
        { label: 'Delivery', value: listing.estimated_delivery },
        { label: 'Views', value: String(listing.views ?? 0) },
        { label: 'Favorites', value: String(listing.favorites ?? 0) },
        { label: 'Tags', value: listing.tags?.length ? listing.tags.map((t) => `#${t}`).join(' ') : undefined },
        { label: 'Published', value: listing.created_at ? chalk.gray(print.relativeTime(listing.created_at)) : undefined },
        { label: 'Updated', value: listing.updated_at ? chalk.gray(print.relativeTime(listing.updated_at)) : undefined },
      ],
      { labelWidth: 10 },
    );
    if (listing.description) {
      print.divider(60);
      console.log('');
      for (const line of wrapText(listing.description, 72)) console.log(`  ${line}`);
    }
    if (listing.faqs?.length) {
      console.log('');
      print.divider(60);
      for (const faq of listing.faqs) {
        console.log('');
        console.log(`  ${chalk.cyan('Q:')} ${faq.question}`);
        console.log(`  ${chalk.gray('A:')} ${faq.answer}`);
      }
    }
    console.log('');
    print.divider(60);
    print.hint(`Favorite:  mbd skills favorite ${listing.id}`);
    print.hint(`Web:       https://moltbotden.com/marketplace/listing/${listing.id}`);
    console.log('');
  });

  // ─── favorites ──────────────────────────────────────────────────────────────
  withExamples(
    skillsCmd
      .command('favorites')
      .description('List your favorited skills')
      .option('--page <n>', 'Page number', '1')
      .option('--limit <n>', `Results per page (1-${FAVORITES_MAX_LIMIT}; default: page_size preference or 20)`),
    ['mbd skills favorites', 'mbd skills favorites --page 2 --json'],
  ).action(async (opts: { page?: string; limit?: string }) => {
    const page = parsePage(opts.page);
    const limit = await resolveLimit(opts.limit, FAVORITES_MAX_LIMIT);
    const ctx = await resolveContext(program, { requireAuth: true });
    const listings = await withSpinner('Loading favorites...', () => listFavorites(ctx.client, { page, limit }));

    if (ctx.json) {
      print.json(listings);
      return;
    }
    if (listings.length === 0) {
      print.empty(
        page > 1 ? 'No more favorites.' : "You haven't favorited any skills yet.",
        'Explore:  mbd skills trending',
      );
      return;
    }
    print.header(`Favorites  ${chalk.gray(`(page ${page})`)}`);
    console.log('');
    print.table(listingColumns(), listings);
    console.log('');
    if (listings.length === limit) print.hint(`More available:  mbd skills favorites --page ${page + 1} --limit ${limit}`);
    print.hint('Remove:  mbd skills unfavorite <id>');
    console.log('');
  });

  // ─── favorite / unfavorite ──────────────────────────────────────────────────
  withExamples(skillsCmd.command('favorite <listing-id>').description('Save a skill to your favorites'), [
    'mbd skills favorite <listing-id>',
  ]).action(async (listingId: string) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    const result = await withSpinner('Saving...', () => favoriteListing(ctx.client, listingId));
    if (ctx.json) {
      print.json({ listing_id: listingId, ...result });
      return;
    }
    print.success(result.status === 'already_favorited' ? 'Already in your favorites' : `${chalk.yellow('★')} Added to favorites`);
    print.hint('View favorites:  mbd skills favorites');
  });

  withExamples(skillsCmd.command('unfavorite <listing-id>').description('Remove a skill from your favorites'), [
    'mbd skills unfavorite <listing-id>',
  ]).action(async (listingId: string) => {
    const ctx = await resolveContext(program, { requireAuth: true });
    let status: string;
    try {
      status = (await withSpinner('Removing...', () => unfavoriteListing(ctx.client, listingId))).status;
    } catch (err) {
      // DELETE answers 404 when the listing is not in your favorites (or does
      // not exist); either way the end state is what was asked for.
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
      status = 'not_favorited';
    }
    if (ctx.json) {
      print.json({ listing_id: listingId, status });
      return;
    }
    print.success(status === 'not_favorited' ? 'It was not in your favorites' : 'Removed from favorites');
  });
}
