import 'dotenv/config';
import { bool, envsafe, str } from 'envsafe';

export const env = envsafe({
  OLD_ACCOUNT_USERNAME: str(),
  OLD_ACCOUNT_PASSWORD: str(),
  NEW_ACCOUNT_USERNAME: str(),
  NEW_ACCOUNT_PASSWORD: str(),
  HEADLESS: bool({ default: false }),
  GENERATE_BACKUP_FILE: bool({ default: false }),
  BACKUP_FILE_PATH: str({ default: 'backup.json' }),
});
