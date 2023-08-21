import '@total-typescript/ts-reset';
import { outputFile, readFile } from 'fs-extra';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import { env } from './env';

interface IBackup {
  done: {
    public: boolean;
    private: boolean;
  };
  public_followers: string[];
  private_followers: string[];
}

const backup_path = resolve(process.cwd(), env.BACKUP_FILE_PATH);
const backup: IBackup = {
  done: {
    public: false,
    private: false,
  },
  public_followers: [],
  private_followers: [],
};

function filterFollowersLinks(links: (string | null)[]) {
  const removedNullLinks = links.filter(Boolean);
  const removedUnnecessaryLinks = removedNullLinks.filter(
    (link) => !link.endsWith('/request')
  );
  const removedDuplicatedLinks = [...new Set(removedUnnecessaryLinks)];
  return removedDuplicatedLinks;
}

async function getFollowersIds(page: Page) {
  const followers_links: string[] = [];

  let hasNextPage = true;

  while (hasNextPage) {
    await page.waitForSelector('section a[href^="/en/users/"]');
    const paginationNextButtonSvg = await page.$('nav > a:last-child > svg');

    const elements = await page.$$('section a[href^="/en/users/"]');
    const elementsHrefs = await Promise.all(
      elements.map((element) => element.getAttribute('href'))
    );
    const filteredElements = filterFollowersLinks(elementsHrefs);
    followers_links.push(...filteredElements);

    if (
      paginationNextButtonSvg &&
      (await paginationNextButtonSvg.isVisible())
    ) {
      const parentElement = await paginationNextButtonSvg.evaluateHandle(
        (el) => el.parentElement
      );
      await parentElement.click();
    } else {
      hasNextPage = false;
    }
  }

  return followers_links.map((link) => link.replace(/^.+\/(\d+)/g, '$1'));
}

async function getFollowers() {
  const browser = await chromium.launch({ headless: env.HEADLESS });
  const page = await browser.newPage();
  await page.goto('https://www.pixiv.net/en/');

  await page.setExtraHTTPHeaders({
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // Login
  await page.getByText('Login').click();
  await page.fill('input[type="text"]', env.OLD_ACCOUNT_USERNAME);
  await page.fill('input[type="password"]', env.OLD_ACCOUNT_PASSWORD);
  await page.click('button[type="submit"]');

  // Go to followers page
  await page.waitForSelector('button div[title]');
  await page.click('button div[title]');
  await page.click('a[href^="/en/users/"][href$="following"]');

  let public_followers = await getFollowersIds(page);

  await page.getByText('Private', { exact: true }).click();

  let private_followers = await getFollowersIds(page);

  public_followers = [...new Set(public_followers)];
  private_followers = [...new Set(private_followers)];

  backup.public_followers = public_followers;
  backup.private_followers = private_followers;

  if (env.GENERATE_BACKUP_FILE) {
    await outputFile(
      backup_path,
      JSON.stringify(
        {
          public_followers,
          private_followers,
          done: { public: false, private: false },
        },
        null,
        2
      ),
      { encoding: 'utf-8' }
    );
  }

  await browser.close();
}

async function addFollowers() {
  const { public_followers, private_followers, done } = backup;
  const browser = await chromium.launch({ headless: env.HEADLESS });
  const page = await browser.newPage();
  await page.goto('https://www.pixiv.net/en/');

  await page.setExtraHTTPHeaders({
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // Login
  await page.getByText('Login').click();
  await page.fill('input[type="text"]', env.NEW_ACCOUNT_USERNAME);
  await page.fill('input[type="password"]', env.NEW_ACCOUNT_PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForSelector('button div[title]');

  // Go to following user page
  if (!done.public) {
    for (const follower of public_followers) {
      await page.goto(`https://www.pixiv.net/en/users/${follower}`);
      await page.waitForLoadState('domcontentloaded');
      const followButton = page.getByRole('button', {
        name: 'Follow',
        exact: true,
      });
      if (await followButton.isVisible()) {
        await followButton.click();
        await page.waitForTimeout(5000);
      }
    }
    if (env.GENERATE_BACKUP_FILE) {
      await outputFile(
        backup_path,
        JSON.stringify(
          {
            public_followers,
            private_followers,
            done: { public: true, private: false },
          },
          null,
          2
        ),
        { encoding: 'utf-8' }
      );
    }
  }

  if (!done.private) {
    for (const follower of private_followers) {
      await page.goto(`https://www.pixiv.net/en/users/${follower}`);
      await page.waitForLoadState('domcontentloaded');
      const followButton = page.getByRole('button', {
        name: 'Follow',
        exact: true,
      });

      if (!(await followButton.isVisible())) {
        continue;
      }

      const parent = await followButton.evaluateHandle(
        (el) => el.parentElement
      );

      const lastChild = await parent.evaluateHandle((p) => p.lastElementChild);
      await lastChild.click();
      await page.getByText('Follow privately').click();
      await page.waitForTimeout(5000);
    }
    if (env.GENERATE_BACKUP_FILE) {
      await outputFile(
        backup_path,
        JSON.stringify(
          {
            public_followers,
            private_followers,
            done: { public: true, private: true },
          },
          null,
          2
        ),
        { encoding: 'utf-8' }
      );
    }
  }

  await browser.close();
}

(async () => {
  if (!existsSync(backup_path)) {
    await getFollowers();
  }

  if (
    !backup.public_followers.length &&
    !backup.private_followers.length &&
    existsSync(backup_path)
  ) {
    const backup_content = JSON.parse(
      await readFile(backup_path, {
        encoding: 'utf-8',
      })
    ) as IBackup;
    backup.done = backup_content.done;
    backup.public_followers = backup_content.public_followers;
    backup.private_followers = backup_content.private_followers;
  }

  await addFollowers();
})();
