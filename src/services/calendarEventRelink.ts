import { supabase } from '../lib/supabase';

/**
 * URL remap(구 URL -> 신규 URL)에 따라 events.calendar_url을 일괄 업데이트합니다.
 */
export const relinkEventsByCalendarUrl = async (
  urlRemap: Map<string, string>,
  logPrefix: string
): Promise<void> => {
  if (urlRemap.size === 0) return;

  for (const [oldUrl, newLocalUrl] of urlRemap.entries()) {
    const { error } = await supabase
      .from('events')
      .update({ calendar_url: newLocalUrl })
      .eq('calendar_url', oldUrl);

    if (error) {
      console.error(`${logPrefix} Event re-link failed: ${oldUrl} ->`, error);
    }
  }
};
