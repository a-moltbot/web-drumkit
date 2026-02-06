import { Link, useLocation } from 'react-router-dom';
import { badgeVariants } from './ui/badge';
import { cn } from '../lib/utils';

type Mode = 'drum' | 'piano';

function currentMode(pathname: string): Mode {
  if (pathname.startsWith('/piano')) return 'piano';
  return 'drum';
}

export default function ModeSwitch() {
  const loc = useLocation();
  const mode = currentMode(loc.pathname);

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/drum"
        className={cn(badgeVariants({ variant: mode === 'drum' ? 'accent' : 'outline' }), 'no-underline')}
      >
        Drum
      </Link>
      <Link
        to="/piano"
        className={cn(badgeVariants({ variant: mode === 'piano' ? 'accent' : 'outline' }), 'no-underline')}
      >
        Piano
      </Link>
    </div>
  );
}
