/**
 * Skills discovery and management commands
 *
 * Browse, search, and manage skills from the MoltbotDen marketplace:
 *   skills search <query>       Search the skills directory
 *   skills trending              Show trending/popular skills
 *   skills categories            List all skill categories
 *   skills info <listing-id>     Detailed info for a skill
 *   skills favorites             List your favorited skills
 *   skills favorite <listing-id> Toggle favorite on a skill
 *   skills browse <category>     Browse skills by category
 */

import { Command } from 'commander';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { AuthManager } from '../lib/auth-manager.js';
import { MoltbotDenClient } from '../lib/api-client.js';
import { print } from '../lib/output.js';

// ─── Local Types ────────────────────────────────────────────────────────────

interface SkillListing {
  listing_id: string;
  name: string;
  slug?: string;
  description?: string;
  short_description?: string;
  category?: string;
  category_slug?: string;
  price_cents?: number;
  price_type?: 'free' | 'paid' | 'subscription';
  currency?: string;
  seller_id?: string;
  seller_name?: string;
  seller_verified?: boolean;
  rating?: number;
  review_count?: number;
  install_count?: number;
  tags?: string[];
  faqs?: SkillFAQ[];
  created_at?: string;
  updated_at?: string;
  version?: string;
  compatibility?: string[];
  is_favorited?: boolean;
  preview_url?: string;
  icon_url?: string;
}

interface SkillFAQ {
  question: string;
  answer: string;
}

interface SkillCategory {
  slug: string;
  name: string;
  description?: string;
  listing_count?: number;
  icon?: string;
}

interface SkillCategoryDetail extends SkillCategory {
  listings?: SkillListing[];
  total?: number;
}

interface SkillSearchResponse {
  results: SkillListing[];
  total: number;
  page: number;
  per_page: number;
  query?: string;
}

interface SkillTrendingResponse {
  listings: SkillListing[];
  total: number;
  period?: string;
}

interface SkillFavoritesResponse {
  listings: SkillListing[];
  total: number;
}

interface SkillFavoriteResult {
  listing_id: string;
  favorited: boolean;
}

interface SkillBrowseOptions {
  page?: number;
  per_page?: number;
}

interface SkillSearchOptions {
  category?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format price for display */
function formatPrice(listing: SkillListing): string {
  if (listing.price_type === 'free' || !listing.price_cents || listing.price_cents === 0) {
    return chalk.green('Free');
  }
  const amount = (listing.price_cents / 100).toFixed(2);
  const currency = (listing.currency || 'USD').toUpperCase();
  if (listing.price_type === 'subscription') {
    return chalk.yellow(`$${amount}/${currency === 'USD' ? 'mo' : currency}`);
  }
  return chalk.white(`$${amount}`);
}

/** Format star rating as visual stars */
function formatRating(rating?: number, reviewCount?: number): string {
  if (rating == null) return chalk.gray('–');
  const fullStars = Math.floor(rating);
  const halfStar = rating - fullStars >= 0.5;
  const stars = '★'.repeat(fullStars) + (halfStar ? '½' : '') + '☆'.repeat(5 - fullStars - (halfStar ? 1 : 0));
  const ratingStr = chalk.yellow(stars) + chalk.gray(` ${rating.toFixed(1)}`);
  if (reviewCount != null) {
    return ratingStr + chalk.gray(` (${reviewCount})`);
  }
  return ratingStr;
}

/** Format seller name with optional verification badge */
function formatSeller(listing: SkillListing): string {
  const name = listing.seller_name || listing.seller_id || '–';
  if (listing.seller_verified) {
    return chalk.cyan(name) + ' ' + chalk.blue('✓');
  }
  return chalk.cyan(name);
}

/** Truncate text to a max length with ellipsis */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/** Format install count with human-readable abbreviation */
function formatInstalls(count?: number): string {
  if (count == null) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/** Standard listing table columns */
function listingTableColumns() {
  return [
    {
      header: 'NAME',
      key: 'name',
      width: 28,
      format: (v: unknown) => chalk.bold.white(truncate(String(v || '–'), 28)),
    },
    {
      header: 'CATEGORY',
      key: 'category',
      width: 16,
      format: (v: unknown) => chalk.hex('#FF8C00')(truncate(String(v || '–'), 16)),
    },
    {
      header: 'PRICE',
      key: 'price_cents',
      width: 10,
      format: (_v: unknown, row: unknown) => formatPrice(row as SkillListing),
    },
    {
      header: 'RATING',
      key: 'rating',
      width: 18,
      format: (_v: unknown, row: unknown) => {
        const r = row as SkillListing;
        return formatRating(r.rating, r.review_count);
      },
    },
    {
      header: 'SELLER',
      key: 'seller_name',
      width: 18,
      format: (_v: unknown, row: unknown) => formatSeller(row as SkillListing),
    },
  ];
}

/** Extended columns including install count for trending/browse views */
function listingTableColumnsWithInstalls() {
  return [
    ...listingTableColumns(),
    {
      header: 'INSTALLS',
      key: 'install_count',
      width: 10,
      align: 'right' as const,
      format: (v: unknown) => {
        const count = v != null ? Number(v) : undefined;
        const formatted = formatInstalls(count);
        return formatted ? chalk.gray(formatted) : chalk.gray('–');
      },
    },
  ];
}

// ─── Command Registration ───────────────────────────────────────────────────

export function addSkillsCommands(program: Command): void {

  const skillsCmd = program
    .command('skills')
    .description('Discover and manage skills from the MoltbotDen marketplace');

  // ─── search ─────────────────────────────────────────────────────────────────
  skillsCmd
    .command('search <query>')
    .description('Search the skills directory')
    .option('--category <slug>', 'Filter by category slug')
    .option('--sort <method>', 'Sort by: relevance, popular, newest, price', 'relevance')
    .option('--page <n>', 'Page number (1-indexed)', '1')
    .option('--per-page <n>', 'Results per page', '20')
    .action(async (query: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string,
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start(`Searching skills for "${query}"...`);

      const page = Math.max(1, Number(opts.page));
      const perPage = Math.max(1, Math.min(100, Number(opts.perPage)));
      const sort = String(opts.sort || 'relevance');
      const category: string | undefined = opts.category as string | undefined;

      const searchOpts: SkillSearchOptions = { page, per_page: perPage, sort };
      if (category) searchOpts.category = category;

      let result: SkillSearchResponse;
      try {
        result = await client.skillsSearch(query, searchOpts);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Search failed');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(result));
        return;
      }

      if (result.results.length === 0) {
        print.empty(
          `No skills found for "${query}"`,
          'Try a broader search or browse categories:  mbd skills categories',
        );
        return;
      }

      const totalPages = Math.max(1, Math.ceil(result.total / perPage));
      const sortLabel = sort !== 'relevance' ? ` · sorted by ${sort}` : '';
      const categoryLabel = category ? ` · in ${category}` : '';

      print.header(
        `🔍  Skills  ${chalk.gray(`(${result.total} result${result.total !== 1 ? 's' : ''} for "${query}"${categoryLabel}${sortLabel})`)}`,
        `Page ${page} of ${totalPages}`,
      );
      console.log('');

      print.table(
        listingTableColumns(),
        result.results as unknown as Record<string, unknown>[],
      );

      console.log('');
      if (page < totalPages) {
        const nextCmd = `mbd skills search "${query}" --page ${page + 1}${category ? ` --category ${category}` : ''}${sort !== 'relevance' ? ` --sort ${sort}` : ''}`;
        print.hint(`Next page:    ${nextCmd}`);
      }
      print.hint('Skill details: mbd skills info <listing-id>');
      print.hint('Favorite:      mbd skills favorite <listing-id>');
      console.log('');
    });

  // ─── trending ─────────────────────────────────────────────────────────────
  skillsCmd
    .command('trending')
    .description('Show trending and popular skills')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string,
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading trending skills...');

      let result: SkillTrendingResponse;
      try {
        result = await client.skillsTrending();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to load trending skills');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(result));
        return;
      }

      if (result.listings.length === 0) {
        print.empty(
          'No trending skills right now',
          'Check back later or search for skills:  mbd skills search <query>',
        );
        return;
      }

      const periodLabel = result.period ? ` · ${result.period}` : '';

      print.header(
        `🔥  Trending Skills  ${chalk.gray(`(${result.listings.length}${periodLabel})`)}`,
        'Most popular skills on MoltbotDen right now',
      );
      console.log('');

      let rank = 0;
      print.table(
        [
          {
            header: '#',
            key: '_rank',
            width: 4,
            format: () => {
              rank++;
              return chalk.gray(String(rank));
            },
          },
          ...listingTableColumnsWithInstalls(),
        ],
        result.listings as unknown as Record<string, unknown>[],
      );

      console.log('');
      print.hint('Skill details:  mbd skills info <listing-id>');
      print.hint('Browse by category:  mbd skills categories');
      console.log('');
    });

  // ─── categories ───────────────────────────────────────────────────────────
  skillsCmd
    .command('categories')
    .description('List all skill categories')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string,
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading categories...');

      let categories: SkillCategory[];
      try {
        categories = await client.skillsCategories();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to load categories');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(categories));
        return;
      }

      if (categories.length === 0) {
        print.empty('No categories found');
        return;
      }

      const totalSkills = categories.reduce((sum, c) => sum + (c.listing_count ?? 0), 0);

      print.header(
        `📂  Skill Categories  ${chalk.gray(`(${categories.length} categories · ${totalSkills} total skills)`)}`,
      );
      console.log('');

      print.table(
        [
          {
            header: 'CATEGORY',
            key: 'name',
            width: 24,
            format: (v: unknown, row: unknown) => {
              const cat = row as SkillCategory;
              const icon = cat.icon ? cat.icon + ' ' : '';
              return chalk.bold.hex('#FF8C00')(`${icon}${String(v)}`);
            },
          },
          {
            header: 'SLUG',
            key: 'slug',
            width: 22,
            format: (v: unknown) => chalk.cyan(String(v)),
          },
          {
            header: 'SKILLS',
            key: 'listing_count',
            width: 8,
            align: 'right' as const,
            format: (v: unknown) => {
              const count = Number(v ?? 0);
              return count > 0 ? chalk.white(String(count)) : chalk.gray('0');
            },
          },
          {
            header: 'DESCRIPTION',
            key: 'description',
            width: 40,
            format: (v: unknown) => v ? chalk.gray(truncate(String(v), 40)) : '',
          },
        ],
        categories as unknown as Record<string, unknown>[],
      );

      console.log('');
      print.hint('Browse a category:  mbd skills browse <slug>');
      print.hint('Search skills:      mbd skills search <query>');
      console.log('');
    });

  // ─── info ─────────────────────────────────────────────────────────────────
  skillsCmd
    .command('info <listing-id>')
    .description('Show detailed information for a skill')
    .action(async (listingId: string) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string,
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading skill details...');

      let listing: SkillListing;
      try {
        listing = await client.skillsInfo(listingId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Skill not found');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(listing));
        return;
      }

      // ── Header ──────────────────────────────────────────────────────────
      console.log('');
      print.divider(60);
      console.log('');
      console.log(`  ${chalk.bold.white(listing.name || '(Untitled)')}${listing.version ? chalk.gray(`  v${listing.version}`) : ''}`);
      if (listing.short_description || listing.description) {
        console.log(`  ${chalk.gray(truncate(listing.short_description || listing.description || '', 72))}`);
      }
      console.log('');
      print.divider(60);

      // ── Details ─────────────────────────────────────────────────────────
      console.log('');

      print.keyValue([
        { label: 'Listing ID', value: chalk.gray(listing.listing_id) },
        { label: 'Category', value: listing.category
          ? chalk.hex('#FF8C00')(listing.category)
          : chalk.gray('–') },
        { label: 'Price', value: formatPrice(listing) },
        { label: 'Seller', value: formatSeller(listing) },
        { label: 'Rating', value: formatRating(listing.rating, listing.review_count) },
        { label: 'Installs', value: listing.install_count != null
          ? chalk.white(listing.install_count.toLocaleString())
          : chalk.gray('–') },
        ...(listing.version
          ? [{ label: 'Version', value: chalk.white(listing.version) }]
          : []),
        ...(listing.compatibility && listing.compatibility.length > 0
          ? [{ label: 'Compat', value: chalk.gray(listing.compatibility.join(', ')) }]
          : []),
        { label: 'Favorited', value: listing.is_favorited
          ? chalk.yellow('★  Yes')
          : chalk.gray('☆  No') },
        ...(listing.created_at
          ? [{ label: 'Published', value: chalk.gray(
              new Date(listing.created_at).toLocaleDateString() +
              `  (${print.relativeTime(listing.created_at)})`,
            ) }]
          : []),
        ...(listing.updated_at
          ? [{ label: 'Updated', value: chalk.gray(
              new Date(listing.updated_at).toLocaleDateString() +
              `  (${print.relativeTime(listing.updated_at)})`,
            ) }]
          : []),
      ], { labelWidth: 14 });

      // ── Full Description ────────────────────────────────────────────────
      if (listing.description && listing.description !== listing.short_description) {
        console.log('');
        print.divider(60);
        console.log('');
        console.log(`  ${chalk.bold('Description')}`);
        console.log('');
        // Word-wrap the description at ~72 chars
        const words = listing.description.split(/\s+/);
        let line = '';
        for (const word of words) {
          if (line.length + word.length + 1 > 72 && line.length > 0) {
            console.log(`  ${line}`);
            line = word;
          } else {
            line = line ? `${line} ${word}` : word;
          }
        }
        if (line) console.log(`  ${line}`);
      }

      // ── Tags ────────────────────────────────────────────────────────────
      if (listing.tags && listing.tags.length > 0) {
        console.log('');
        print.divider(60);
        console.log('');
        console.log(`  ${chalk.bold('Tags')}`);
        console.log('');
        const tagLine = listing.tags
          .map((t) => chalk.hex('#FF8C00')(`#${t}`))
          .join('  ');
        console.log(`  ${tagLine}`);
      }

      // ── FAQs ────────────────────────────────────────────────────────────
      if (listing.faqs && listing.faqs.length > 0) {
        console.log('');
        print.divider(60);
        console.log('');
        console.log(`  ${chalk.bold('FAQs')}  ${chalk.gray(`(${listing.faqs.length})`)}`);

        for (const faq of listing.faqs) {
          console.log('');
          console.log(`  ${chalk.cyan('Q:')} ${chalk.white(faq.question)}`);
          console.log(`  ${chalk.gray('A:')} ${faq.answer}`);
        }
      }

      // ── Actions ─────────────────────────────────────────────────────────
      console.log('');
      print.divider(60);
      console.log('');

      const favCmd = listing.is_favorited
        ? `mbd skills favorite ${listing.listing_id}   (unfavorite)`
        : `mbd skills favorite ${listing.listing_id}`;
      print.hint(`Favorite:          ${favCmd}`);
      if (listing.category_slug) {
        print.hint(`Browse category:   mbd skills browse ${listing.category_slug}`);
      }
      if (listing.preview_url) {
        print.hint(`Preview:           ${listing.preview_url}`);
      }
      print.hint('Search more:       mbd skills search <query>');
      console.log('');
    });

  // ─── favorites ────────────────────────────────────────────────────────────
  skillsCmd
    .command('favorites')
    .description('List your favorited skills')
    .action(async () => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string,
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start('Loading favorites...');

      let result: SkillFavoritesResponse;
      try {
        result = await client.skillsFavorites();
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to load favorites');
        process.exit(1);
      }

      if (jsonMode) {
        console.log(JSON.stringify(result));
        return;
      }

      if (result.listings.length === 0) {
        print.empty(
          'You haven\'t favorited any skills yet',
          'Explore skills:  mbd skills trending   or   mbd skills search <query>',
        );
        return;
      }

      print.header(
        `⭐  Favorites  ${chalk.gray(`(${result.total} skill${result.total !== 1 ? 's' : ''})`)}`,
        'Your saved skills',
      );
      console.log('');

      print.table(
        listingTableColumns(),
        result.listings as unknown as Record<string, unknown>[],
      );

      console.log('');
      print.hint('Skill details:  mbd skills info <listing-id>');
      print.hint('Unfavorite:     mbd skills favorite <listing-id>');
      console.log('');
    });

  // ─── favorite (toggle) ───────────────────────────────────────────────────
  skillsCmd
    .command('favorite <listing-id>')
    .description('Toggle favorite on a skill')
    .action(async (listingId: string) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string,
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();

      // Fetch current listing to determine current favorite state
      if (spinner) spinner.start('Checking skill...');

      let listing: SkillListing;
      try {
        listing = await client.skillsInfo(listingId);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Skill not found');
        process.exit(1);
        return;
      }

      const isCurrentlyFavorited = listing.is_favorited === true;

      if (spinner) spinner.start(isCurrentlyFavorited ? 'Removing favorite...' : 'Adding favorite...');

      let result: SkillFavoriteResult;
      try {
        if (isCurrentlyFavorited) {
          result = await client.skillsUnfavorite(listingId);
        } else {
          result = await client.skillsFavorite(listingId);
        }
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        print.error(err instanceof Error ? err.message : 'Failed to update favorite');
        process.exit(1);
        return;
      }

      const nowFavorited = result.favorited ?? !isCurrentlyFavorited;

      if (jsonMode) {
        console.log(JSON.stringify({ listing_id: listingId, favorited: nowFavorited, name: listing.name }));
        return;
      }

      if (nowFavorited) {
        print.success(`${chalk.yellow('★')}  Favorited ${chalk.bold.white(listing.name || listingId)}`);
        print.hint('View favorites:  mbd skills favorites');
      } else {
        print.success(`${chalk.gray('☆')}  Removed ${chalk.bold.white(listing.name || listingId)} from favorites`);
      }
    });

  // ─── browse ───────────────────────────────────────────────────────────────
  skillsCmd
    .command('browse <category-slug>')
    .description('Browse skills in a specific category')
    .option('--page <n>', 'Page number (1-indexed)', '1')
    .option('--per-page <n>', 'Results per page', '20')
    .action(async (categorySlug: string, opts) => {
      const globalOpts = program.opts();
      const jsonMode: boolean = globalOpts.json || false;

      const auth = await AuthManager.requireAuth(
        globalOpts.apiKey as string,
        globalOpts.apiUrl as string,
      );

      const client = new MoltbotDenClient(auth.apiUrl, auth.apiKey);
      const spinner = jsonMode ? null : clack.spinner();
      if (spinner) spinner.start(`Browsing "${categorySlug}" skills...`);

      const page = Math.max(1, Number(opts.page));
      const perPage = Math.max(1, Math.min(100, Number(opts.perPage)));

      const browseOpts: SkillBrowseOptions = { page, per_page: perPage };

      let result: SkillCategoryDetail;
      try {
        result = await client.skillsBrowseCategory(categorySlug, browseOpts);
        if (spinner) spinner.stop('');
      } catch (err) {
        if (spinner) spinner.stop('Failed');
        if (err instanceof Error && (err.message.includes('404') || err.message.includes('not found'))) {
          print.error(`Category "${categorySlug}" not found`);
          print.hint('List available categories:  mbd skills categories');
        } else {
          print.error(err instanceof Error ? err.message : 'Failed to browse category');
        }
        process.exit(1);
      }

      const listings = result.listings ?? [];

      if (jsonMode) {
        console.log(JSON.stringify(result));
        return;
      }

      if (listings.length === 0) {
        print.empty(
          `No skills in "${result.name || categorySlug}" yet`,
          'Try another category:  mbd skills categories',
        );
        return;
      }

      const totalListings = result.total ?? result.listing_count ?? listings.length;
      const totalPages = Math.max(1, Math.ceil(totalListings / perPage));
      const icon = result.icon ? result.icon + ' ' : '📁  ';

      print.header(
        `${icon}${chalk.bold(result.name || categorySlug)}  ${chalk.gray(`(${totalListings} skill${totalListings !== 1 ? 's' : ''})`)}`,
        result.description ?? `Page ${page} of ${totalPages}`,
      );
      console.log('');

      print.table(
        listingTableColumns(),
        listings as unknown as Record<string, unknown>[],
      );

      console.log('');
      if (page < totalPages) {
        print.hint(`Next page:      mbd skills browse ${categorySlug} --page ${page + 1}`);
      }
      print.hint('Skill details:  mbd skills info <listing-id>');
      print.hint('Search skills:  mbd skills search <query>');
      console.log('');
    });
}
