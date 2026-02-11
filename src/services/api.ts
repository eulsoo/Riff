
import { supabase } from '../lib/supabase';
import { DayDefinition, DiaryEntry, Event, Routine, RoutineCompletion, Todo } from '../types';

// 캘린더 URL 정규화: 끝의 슬래시 제거
export const normalizeCalendarUrl = (url?: string | null) =>
  url ? url.replace(/\/+$/, '') : url;

// 캘린더 메타데이터 저장을 위한 로컬 스토리지 키
const CALENDAR_METADATA_KEY = 'caldavCalendarMetadata';
const LOCAL_CALENDAR_METADATA_KEY = 'localCalendarMetadata';

export interface CalendarMetadata {
  url: string; // 로컬 캘린더의 경우 'local:' 접두사가 붙은 ID
  displayName: string;
  color: string;
  isLocal?: boolean;
  isVisible?: boolean;
  type?: 'local' | 'subscription' | 'caldav';
  subscriptionUrl?: string;
  isShared?: boolean;
  isSubscription?: boolean;
  readOnly?: boolean;
  createdFromApp?: boolean; // 앱에서 생성되어 외부로 동기화된 캘린더 식별
}

// CalDAV 메타데이터 저장 (로컬 캘린더 제외)
// createdFromApp 플래그는 기존 데이터에서 유지 (단, 새 데이터에 해당 캘린더가 있을 때만)
export const saveCalendarMetadata = (metadata: CalendarMetadata[]) => {
  if (typeof window === 'undefined') return;
  try {
    // 기존 메타데이터에서 createdFromApp 플래그 가져오기
    const existingRaw = window.localStorage.getItem(CALENDAR_METADATA_KEY);
    const existingMap: Record<string, CalendarMetadata> = existingRaw ? JSON.parse(existingRaw) : {};

    const map = metadata
      .filter(m => !m.isLocal) // 로컬 제외하고 저장
      .reduce((acc, item) => {
        const normalizedUrl = normalizeCalendarUrl(item.url)!;
        // 기존에 createdFromApp: true였던 캘린더는 플래그 유지
        const existingMeta = existingMap[normalizedUrl];
        acc[normalizedUrl] = { 
          ...item, 
          url: normalizedUrl,
          // 새 데이터에 createdFromApp이 없으면 기존 값 유지
          createdFromApp: item.createdFromApp ?? existingMeta?.createdFromApp
        };
        return acc;
      }, {} as Record<string, CalendarMetadata>);
    window.localStorage.setItem(CALENDAR_METADATA_KEY, JSON.stringify(map));
  } catch (error) {
    console.error('Error saving calendar metadata:', error);
  }
};

export const saveLocalCalendarMetadata = (metadata: CalendarMetadata[]) => {
  if (typeof window === 'undefined') return;
  try {
    // 로컬 캘린더만 필터링해서 저장
    const localOnly = metadata.filter(m => m.isLocal);
    window.localStorage.setItem(LOCAL_CALENDAR_METADATA_KEY, JSON.stringify(localOnly));
  } catch (error) {
    console.error('Error saving local calendar metadata:', error);
  }
};

export const getCalendarMetadata = (): Record<string, CalendarMetadata> => {
  if (typeof window === 'undefined') return {};
  try {
    // CalDAV 캘린더
    const rawCalDAV = window.localStorage.getItem(CALENDAR_METADATA_KEY);
    const caldavMap = rawCalDAV ? JSON.parse(rawCalDAV) : {};

    // 로컬 캘린더
    const rawLocal = window.localStorage.getItem(LOCAL_CALENDAR_METADATA_KEY);
    const localList: CalendarMetadata[] = rawLocal ? JSON.parse(rawLocal) : [];
    
    // 로컬 캘린더를 맵에 병합
    localList.forEach(cal => {
      caldavMap[cal.url] = { ...cal, isLocal: true };
    });

    return caldavMap;
  } catch {
    return {};
  }
};


// 아바타 업로드
export const uploadAvatar = async (file: File, userId: string): Promise<string | null> => {
  const ext = file.name.split('.').pop() || 'png';
  const path = `avatars/${userId}/avatar-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true });

  if (uploadError) {
    console.error('Error uploading avatar:', uploadError);
    return null;
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return data?.publicUrl || null;
};

export const saveUserAvatar = async (avatarUrl: string): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from('user_avatars')
    .upsert({ user_id: user.id, avatar_url: avatarUrl, updated_at: new Date().toISOString() });

  if (error) {
    console.error('Error saving avatar url:', error);
    return false;
  }
  return true;
};

export const getUserAvatar = async (): Promise<string | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_avatars')
    .select('avatar_url')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error fetching avatar url:', error);
    }
    return null;
  }
  return data?.avatar_url || null;
};

const META_ID = '======VIVIDLY_META======';

function serializeMemo(memo: string | undefined, meta: Record<string, any>): string {
  const cleanMemo = memo ? memo.split(META_ID)[0].trimEnd() : '';
  if (!meta || Object.keys(meta).length === 0) return cleanMemo;
  return `${cleanMemo}\n${META_ID}\n${JSON.stringify(meta)}`;
}

function parseMemo(originalMemo: string | undefined): { memo: string | undefined; meta: Record<string, any> } {
  if (!originalMemo) return { memo: undefined, meta: {} };
  const parts = originalMemo.split(META_ID);
  if (parts.length < 2) return { memo: originalMemo, meta: {} };
  try {
    const meta = JSON.parse(parts[1].trim());
    return { memo: parts[0].trimEnd() || undefined, meta };
  } catch {
    return { memo: originalMemo, meta: {} };
  }
}

// Events
export const fetchEvents = async (startDate?: string, endDate?: string) => {
  let query = supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true });

  if (startDate) {
    query = query.gte('date', startDate);
  }
  if (endDate) {
    query = query.lte('date', endDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching events:', error);
    return [];
  }
  return (data || []).map((event: any) => {
    const { memo, meta } = parseMemo(event.memo);
    return {
      ...event,
      memo, // Cleaned memo
      startTime: event.start_time,
      endTime: event.end_time,
      endDate: event.end_date || meta.endDate, // Prefer DB col, fallback to meta
      calendarUrl: normalizeCalendarUrl(event.calendar_url),
      caldavUid: event.caldav_uid,
    };
  });
};

export const createEvent = async (event: Omit<Event, 'id'> & { uid?: string; caldavUid?: string; calendarUrl?: string; source?: string }) => {
  // uid, caldavUid, calendarUrl, source는 제외하고 나머지만 사용
  const { startTime, endTime, endDate, uid, caldavUid, calendarUrl, source, ...rest } = event;
  
  // rest에서 불필요한 필드 제거 (uid, caldavUid가 포함되어 있을 수 있음)
  const cleanRest: any = { ...rest };
  delete cleanRest.uid;
  delete cleanRest.caldavUid;
  
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl || undefined);

  const payload: any = {
    ...cleanRest,
    start_time: startTime,
    end_time: endTime,
    // end_date: endDate, // REMOVED: DB column likely missing
    memo: serializeMemo(rest.memo, { endDate }), // Store in Meta only
    source: source || 'manual',
  };
  
  // uid 또는 caldavUid 중 하나를 사용
  const eventUid = uid || caldavUid;
  if (eventUid) {
    payload.caldav_uid = eventUid;
  }
  if (normalizedCalendarUrl) {
    payload.calendar_url = normalizedCalendarUrl;
  }
  if (event.etag) {
    payload.etag = event.etag;
  }
  // Allow restoring specific ID (e.g. for Undo Delete)
  if ((event as any).id) {
    payload.id = (event as any).id;
  }

  const { data, error } = await supabase
    .from('events')
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error('Error creating event:', error);
    return null;
  }
  const { memo: parsedMemo, meta } = parseMemo(data.memo);
  return {
    ...data,
    memo: parsedMemo, // Return clean memo
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: meta.endDate || data.end_date, // Prefer Meta
    calendarUrl: data.calendar_url,
    caldavUid: data.caldav_uid,
  };
};

// CalDAV 동기화용 Upsert (없으면 생성, 있으면 업데이트)
export const upsertEvent = async (event: Omit<Event, 'id'> & { uid?: string; caldavUid?: string; calendarUrl?: string; source?: string }) => {
  const { startTime, endTime, endDate, uid, caldavUid, calendarUrl, source, ...rest } = event;
  
  const cleanRest: any = { ...rest };
  delete cleanRest.uid;
  delete cleanRest.caldavUid;
  
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl || undefined);

  const payload: any = {
    ...cleanRest,
    start_time: startTime,
    end_time: endTime,
    // end_date: endDate, // REMOVED: DB column likely missing
    memo: serializeMemo(rest.memo, { endDate }), // Store in Meta
    source: source || 'caldav',
  };
  
  const eventUid = uid || caldavUid;
  if (eventUid) payload.caldav_uid = eventUid;
  if (normalizedCalendarUrl) payload.calendar_url = normalizedCalendarUrl;
  if (event.etag) payload.etag = event.etag;

  const { data, error } = await supabase
    .from('events')
    .upsert(payload, { onConflict: 'caldav_uid,calendar_url' })
    .select()
    .single();

  if (error) {
    console.error('Error upserting event:', error);
    return null;
  }
  const { memo: parsedMemo, meta } = parseMemo(data.memo);
  return {
    ...data,
    memo: parsedMemo,
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: meta.endDate || data.end_date,
    calendarUrl: data.calendar_url,
    caldavUid: data.caldav_uid,
  };
};

// UID로 이벤트 존재 확인
export const eventExistsByUID = async (uid: string, calendarUrl: string): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('caldav_uid', uid)
    .eq('calendar_url', normalizedCalendarUrl)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error checking event by UID:', error);
    return false;
  }

  return data !== null;
};

// 기존 이벤트에 UID 업데이트
export const updateEventUID = async (
  eventId: string,
  uid: string,
  calendarUrl: string
): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { error } = await supabase
    .from('events')
    .update({ caldav_uid: uid, calendar_url: normalizedCalendarUrl, source: 'caldav' })
    .eq('id', eventId);

  if (error) {
    console.error('Error updating event UID:', error);
    return false;
  }
  return true;
};

// UID로 기존 이벤트 업데이트 (제목/날짜/시간 등 변경 반영)
export const fetchEventByUID = async (
  uid: string,
  calendarUrl: string
): Promise<Event | null> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { data, error } = await supabase
    .from('events')
    .select('id, title, date, memo, start_time, end_time, color, calendar_url, source, etag')
    .eq('caldav_uid', uid)
    .eq('calendar_url', normalizedCalendarUrl)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching event by UID:', error);
    return null;
  }

  if (!data) return null;

  const { memo: parsedMemo, meta } = parseMemo(data.memo);

  return {
    ...data,
    memo: parsedMemo,
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: meta.endDate, // Restore from meta
    etag: data.etag,
  };
};

export const updateEventByUID = async (
  uid: string,
  calendarUrl: string,
  updates: Partial<{
    title: string;
    date: string;
    memo: string | null;
    startTime: string | null;
    endTime: string | null;
    endDate?: string | null;
    etag?: string | null;
  }>
): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const payload: any = {};
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.date !== undefined) payload.date = updates.date;
  if (updates.memo !== undefined) payload.memo = updates.memo;
  if (updates.startTime !== undefined) payload.start_time = updates.startTime;
  if (updates.endTime !== undefined) payload.end_time = updates.endTime;
  if (updates.etag !== undefined) payload.etag = updates.etag;

  // Handle endDate & memo metadata logic
  if (updates.endDate !== undefined) {
    // payload.end_date = updates.endDate; // Removed
    // delete payload.endDate; // Not in payload object initially

    // We must ensure memo is updated with new endDate meta
    let currentMemo = updates.memo;
    
    // If memo is strictly undefined (not null), we might need to fetch existing
    if (currentMemo === undefined) {
      // NOTE: Unlike updateEvent, updateEventByUID is often used during sync where we might have full data or partial.
      // If we don't have memo in updates, we should check DB.
      // However, fetching here adds latency to sync.
      // Let's assume if it's undefined, we fetch.
      const { data: existing } = await supabase
        .from('events')
        .select('memo')
        .eq('caldav_uid', uid)
        .eq('calendar_url', normalizedCalendarUrl)
        .single();
        
      if (existing) {
        const parsed = parseMemo(existing.memo);
        currentMemo = parsed.memo;
      }
    }
    // Note: updates.memo could be null (cleared). verify serializeMemo handles null.
    // serializeMemo expects string | undefined. null -> undefined.
    payload.memo = serializeMemo(currentMemo || undefined, { endDate: updates.endDate });

  } else if (payload.memo !== undefined) {
    // Memo changed, preserve endDate if exists
    const { data: existing } = await supabase
      .from('events')
      .select('memo')
      .eq('caldav_uid', uid)
      .eq('calendar_url', normalizedCalendarUrl)
      .single();
      
    if (existing) {
      const parsed = parseMemo(existing.memo);
      const existingEndDate = parsed.meta.endDate;
      if (existingEndDate) {
        payload.memo = serializeMemo(payload.memo, { endDate: existingEndDate });
      } else {
        payload.memo = serializeMemo(payload.memo, {});
      }
    }
  }

  const { error } = await supabase
    .from('events')
    .update(payload)
    .eq('caldav_uid', uid)
    .eq('calendar_url', normalizedCalendarUrl);

  if (error) {
    console.error('Error updating event by UID:', error);
    return false;
  }
  return true;
};

// 제목, 날짜, 시간으로 이벤트 찾기 (UID가 없는 기존 이벤트용)
export const findEventByDetails = async (
  event: Omit<Event, 'id'>,
  calendarUrl: string
): Promise<string | null> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const { data, error } = await supabase
    .from('events')
    .select('id')
    .eq('title', event.title)
    .eq('date', event.date)
    .eq('start_time', event.startTime || null)
    .eq('end_time', event.endTime || null)
    .eq('calendar_url', normalizedCalendarUrl)
    .eq('source', 'caldav')
    .is('caldav_uid', null) // UID가 없는 이벤트만
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error finding event by details:', error);
    return null;
  }

  return data?.id || null;
};

// 삭제된 이벤트 삭제
export const deleteRemovedEvents = async (
  calendarUrl: string,
  currentUids: Set<string>,
  currentEvents: Array<{ title: string; date: string; startTime?: string; endTime?: string }>,
  startDate?: Date, // 범위 제한을 위한 시작일
  endDate?: Date    // 범위 제한을 위한 종료일
): Promise<number> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);
  const altCalendarUrl = normalizedCalendarUrl ? `${normalizedCalendarUrl}/` : undefined;
  // 현재 이벤트가 없어도 삭제 체크는 수행 (캘린더에서 모든 이벤트를 삭제한 경우를 처리)

  // 안전장치: CalDAV에서 이벤트를 하나도 못 받아온 경우(네트워크 오류/일시적 빈 응답) 삭제를 건너뜀
  if (currentEvents.length === 0 && currentUids.size === 0) {
    console.warn(`삭제 체크 스킵: CalDAV에서 가져온 이벤트가 0개입니다. calendarUrl=${normalizedCalendarUrl}`);
    return 0;
  }

  // 해당 캘린더의 모든 CalDAV 이벤트 가져오기 (기간 제한 적용)
  let query = supabase
    .from('events')
    .select('id, caldav_uid, title, date, start_time, end_time')
    .in('calendar_url', altCalendarUrl ? [normalizedCalendarUrl, altCalendarUrl] : [normalizedCalendarUrl])
    .eq('source', 'caldav');

  // 삭제 검사 범위를 가져온 데이터의 범위로 한정
  if (startDate) {
    const sStr = startDate.toISOString().split('T')[0];
    query = query.gte('date', sStr);
  }
  if (endDate) {
    const eStr = endDate.toISOString().split('T')[0];
    query = query.lte('date', eStr);
  }

  const { data: existingEvents, error: fetchError } = await query;

  if (fetchError || !existingEvents) {
    console.error('Error fetching events for deletion check:', fetchError);
    return 0;
  }

  // 안전장치: 기존 이벤트가 너무 많고(100개 초과) 현재 이벤트가 통째로 비어있으면(0개),
  // 혹시 모를 "네트워크 오류로 인해 가져온게 0개인 상황"을 대비해 삭제를 건너뜀.
  // 단, 기존 이벤트가 소량(<= 100)이면 사용자가 진짜 다 지웠을 수 있으므로 삭제 허용.
  if (existingEvents.length > 100 && currentEvents.length === 0 && currentUids.size === 0) {
    console.warn(`삭제 체크 안전장치: 기존 이벤트가 ${existingEvents.length}개인데 현재 이벤트가 0개여서 삭제를 건너뜁니다. (데이터 손실 방지)`);
    return 0;
  }

  // 현재 CalDAV에 있는 이벤트의 키 생성 (제목+날짜+시간)
  const currentEventKeys = new Set<string>();
  for (const event of currentEvents) {
    const key = `${event.title}|${event.date}|${event.startTime || ''}|${event.endTime || ''}`;
    currentEventKeys.add(key);
  }

  // 삭제할 이벤트 찾기
  const toDelete: string[] = [];
  
  for (const existingEvent of existingEvents) {
    let shouldDelete = false;
    
    if (existingEvent.caldav_uid) {
      // UID가 있는 경우: UID로 비교
      if (!currentUids.has(existingEvent.caldav_uid)) {
        shouldDelete = true;
      }
    } else {
      // UID가 없는 경우: 제목+날짜+시간으로 비교
      const key = `${existingEvent.title}|${existingEvent.date}|${existingEvent.start_time || ''}|${existingEvent.end_time || ''}`;
      if (!currentEventKeys.has(key)) {
        shouldDelete = true;
      }
    }
    
    if (shouldDelete) {
      toDelete.push(existingEvent.id);
    }
  }

  // 안전장치: 대량 삭제 방지 로직 개선
  // 기존: 10개 이상이고 90% 이상 삭제면 차단.
  // 변경: "초기 동기화"나 "캘린더 이동" 같은 상황에서는 대량 삭제가 발생할 수 있음.
  // 따라서, 무조건 막는게 아니라 '경고'만 하고 진행하거나 조건을 완화해야 함.
  // 여기서는 "50개 이상"일 때만 비율 체크를 하고, 정말 위험해 보일 때만 막도록 수정.
  
  if (existingEvents.length >= 50 && toDelete.length > existingEvents.length * 0.95) {
      console.warn(`삭제 체크 경고: 삭제 대상이 매우 많습니다 (${toDelete.length}/${existingEvents.length}). 동기화 무결성을 위해 진행합니다.`);
      // return 0; // 차단하지 않고 진행하도록 변경 (사용자가 웹에서 캘린더를 바꿨거나 대량 정리를 했을 수 있음)
  }
  
  // 안전장치: 기존 이벤트가 5개 이상이고, 삭제할 이벤트가 80% 이상인 경우 경고만 하고 진행
  if (existingEvents.length >= 5 && toDelete.length > existingEvents.length * 0.8) {
    console.warn(`삭제 체크: 삭제 대상이 많습니다 (${toDelete.length}/${existingEvents.length}). 계속 진행합니다.`);
  }

  if (toDelete.length > 0) {
    console.log(`삭제 예정: ${toDelete.length}개 (기존: ${existingEvents.length}개, 현재: ${currentEvents.length}개)`);
    
    // 배치로 나누어 삭제 (한 번에 최대 50개씩 - URL 길이 제한 고려)
    const batchSize = 50;
    let deletedCount = 0;
    
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      const { error: deleteError } = await supabase
        .from('events')
        .delete()
        .in('id', batch);

      if (deleteError) {
        console.error(`Error deleting batch ${Math.floor(i / batchSize) + 1}:`, deleteError);
        // 에러가 발생해도 다음 배치 계속 처리
        continue;
      }
      
      deletedCount += batch.length;
    }
    
    if (deletedCount > 0) {
      console.log(`삭제 완료: ${deletedCount}개`);
    }
    
    return deletedCount;
  }

  return 0;
};

export const deleteEvent = async (id: string) => {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting event:', error);
    return false;
  }
  return true;
};

export const updateEvent = async (id: string, updates: Partial<{
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  endDate?: string;
  color: string;
  calendarUrl?: string;
}>) => {
  const payload: any = { ...updates };
  if (updates.startTime !== undefined) {
    payload.start_time = updates.startTime;
    delete payload.startTime;
  }
  if (updates.endTime !== undefined) {
    payload.end_time = updates.endTime;
    delete payload.endTime;
  }
  
  // Handle endDate & memo metadata logic
  // Handle endDate & memo metadata logic
  if (updates.endDate !== undefined) {
    // payload.end_date = updates.endDate; // REMOVED
    delete payload.endDate;

    // If endDate changed, we must update memo to store metadata
    let currentMemo = updates.memo;
    
    // If user didn't change memo (undefined), we fetch existing to preserve it
    if (currentMemo === undefined) {
      const { data: existing } = await supabase.from('events').select('memo').eq('id', id).single();
      if (existing) {
        const parsed = parseMemo(existing.memo);
        currentMemo = parsed.memo;
      }
    }
    payload.memo = serializeMemo(currentMemo, { endDate: updates.endDate });
  
  } else if (payload.memo !== undefined) {
    // Only memo changed. We must preserve existing endDate metadata.
    const { data: existing } = await supabase.from('events').select('memo').eq('id', id).single();
    if (existing) {
      const parsed = parseMemo(existing.memo);
      const existingEndDate = parsed.meta.endDate; // Only rely on Meta
      // If there was an endDate, re-serialize with it
      if (existingEndDate) {
        payload.memo = serializeMemo(payload.memo, { endDate: existingEndDate });
      } else {
        // No existing endDate, just clean memo? No, just use what user sent.
        // User sent raw memo text. serializeMemo will add meta if provided.
        // Here we provide nothing, so it cleans it? No, we should call serializeMemo to ensure format if we want consistency,
        // or just let it be. But serializeMemo also strips existing meta if we don't pass it.
        // So payload.memo is raw. If we save it directly, we lose meta.
        // So we MUST use serializeMemo here too.
        payload.memo = serializeMemo(payload.memo, {});
      }
    }
  }

  // calendarUrl -> calendar_url 매핑
  if ('calendarUrl' in updates) {
    payload.calendar_url = updates.calendarUrl;
    delete payload.calendarUrl;
  }

  const { data, error } = await supabase
    .from('events')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating event:', error);
    return null;
  }
  return {
    ...data,
    startTime: data.start_time,
    endTime: data.end_time,
    endDate: data.end_date, // This might be null if DB col missing, but we rely on fetchEvents to parse it next time
    calendarUrl: data.calendar_url,
  };
};

// Routines
export const fetchRoutines = async () => {
  const { data, error } = await supabase
    .from('routines')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching routines:', error);
    return [];
  }
  return (data || []).map((routine: any) => ({
    ...routine,
    createdAt: routine.created_at,
  }));
};

export const createRoutine = async (routine: Omit<Routine, 'id'>) => {
  const { data, error } = await supabase
    .from('routines')
    .insert([routine])
    .select()
    .single();

  if (error) {
    console.error('Error creating routine:', error);
    return null;
  }
  return {
    ...data,
    createdAt: data.created_at,
  };
};

export const deleteRoutine = async (id: string) => {
  const { error } = await supabase
    .from('routines')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting routine:', error);
    return false;
  }
  return true;
};

// Routine Completions
export const fetchRoutineCompletions = async () => {
  const { data, error } = await supabase
    .from('routine_completions')
    .select('*');

  if (error) {
    console.error('Error fetching completions:', error);
    return [];
  }
  // Map snake_case to camelCase if needed, but for now assuming direct match except table columns
  // Our SQL table has routine_id (snake_case). The App expects camelCase usually?
  // Let's check App.tsx types: routineId.
  // We need to map routine_id -> routineId.
  return (data || []).map((item: any) => ({
    ...item,
    routineId: item.routine_id,
  }));
};

export const toggleRoutineCompletion = async (routineId: string, date: string, completed: boolean) => {
  // Upsert logic
  // If exists, update. If not, insert.
  // But wait, if we toggle off, do we delete or set false?
  // The App logic: "completed: !rc.completed".
  // Database: completed boolean default false.
  
  const { data, error } = await supabase
    .from('routine_completions')
    .upsert(
      { routine_id: routineId, date, completed },
      { onConflict: 'routine_id,date' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error toggling routine:', error);
    return null;
  }
  return { ...data, routineId: data.routine_id };
};

// Todos
export const fetchTodos = async () => {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching todos:', error);
    return [];
  }
  return (data || []).map((item: any) => ({
    ...item,
    weekStart: item.week_start,
  }));
};

export const createTodo = async (todo: Omit<Todo, 'id'>) => {
  const { weekStart, ...rest } = todo as any; 
  // Map weekStart -> week_start
  const payload = {
    ...rest,
    week_start: todo.weekStart
  };

  const { data, error } = await supabase
    .from('todos')
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error('Error creating todo:', error);
    return null;
  }
  return { ...data, weekStart: data.week_start };
};

export const updateTodo = async (id: string, updates: Partial<Todo>) => {
  const payload: any = { ...updates };
  if (updates.weekStart) {
    payload.week_start = updates.weekStart;
    delete payload.weekStart;
  }

  const { data, error } = await supabase
    .from('todos')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating todo:', error);
    return null;
  }
  return { ...data, weekStart: data.week_start };
};

export const deleteTodo = async (id: string) => {
  const { error } = await supabase
    .from('todos')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting todo:', error);
    return false;
  }
  return true;
};

// Diary Entries
export const fetchDiaryEntry = async (date: string): Promise<DiaryEntry | null> => {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('date, title, content, updated_at')
    .eq('date', date)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching diary entry:', error);
    return null;
  }

  if (!data) return null;

  return {
    date: data.date,
    title: data.title || '',
    content: data.content || '',
    updatedAt: data.updated_at,
  };
};

export const fetchDiaryEntriesByRange = async (startDate: string, endDate: string): Promise<DiaryEntry[]> => {
  const { data, error } = await supabase
    .from('diary_entries')
    .select('date, title, content, updated_at')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true });

  if (error) {
    console.error('Error fetching diary entries:', error);
    return [];
  }

  return (data || []).map((item: any) => ({
    date: item.date,
    title: item.title || '',
    content: item.content || '',
    updatedAt: item.updated_at,
  }));
};

export const upsertDiaryEntry = async (date: string, title: string, content: string): Promise<DiaryEntry | null> => {
  const { data, error } = await supabase
    .from('diary_entries')
    .upsert(
      { date, title, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    )
    .select('date, title, content, updated_at')
    .single();

  if (error) {
    console.error('Error saving diary entry:', error);
    return null;
  }

  return {
    date: data.date,
    title: data.title || '',
    content: data.content || '',
    updatedAt: data.updated_at,
  };
};

export const deleteDiaryEntry = async (date: string): Promise<boolean> => {
  const { error } = await supabase
    .from('diary_entries')
    .delete()
    .eq('date', date);

  if (error) {
    console.error('Error deleting diary entry:', error);
    return false;
  }
  return true;
};

// Day Definitions
export const fetchDayDefinitions = async (): Promise<DayDefinition[]> => {
  const { data, error } = await supabase
    .from('day_definitions')
    .select('*')
    .order('date', { ascending: true });

  if (error) {
    console.error('Error fetching day definitions:', error);
    return [];
  }

  return (data || []).map((item: any) => ({
    id: item.id,
    date: item.date,
    text: item.text || '',
  }));
};

export const upsertDayDefinition = async (date: string, text: string): Promise<DayDefinition | null> => {
  const { data, error } = await supabase
    .from('day_definitions')
    .upsert(
      { date, text },
      { onConflict: 'date' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error saving day definition:', error);
    return null;
  }

  return {
    id: data.id,
    date: data.date,
    text: data.text || '',
  };
};

export const deleteDayDefinition = async (date: string): Promise<boolean> => {
  const { error } = await supabase
    .from('day_definitions')
    .delete()
    .eq('date', date);

  if (error) {
    console.error('Error deleting day definition:', error);
    return false;
  }
  return true;
};

// CalDAV Sync Settings
export interface CalDAVSyncSettings {
  id: string;
  serverUrl: string;
  username: string;
  password: string;
  selectedCalendarUrls: string[];
  syncIntervalMinutes: number;
  enabled: boolean;
  lastSyncAt?: string;
}

export const getCalDAVSyncSettings = async (): Promise<CalDAVSyncSettings | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  try {
    // RLS가 자동으로 user_id를 필터링하므로 .eq('user_id', user.id) 제거
    const { data, error } = await supabase
      .from('caldav_sync_settings')
      .select('*')
      .eq('enabled', true)
      .maybeSingle(); // .single() 대신 .maybeSingle() 사용 (없으면 null 반환)

    if (error) {
      // PGRST116은 "no rows returned"이므로 정상적인 경우
      if (error.code === 'PGRST116' || error.message?.includes('No rows')) {
        return null;
      }
      console.error('Error fetching CalDAV sync settings:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id,
      serverUrl: data.server_url,
      username: data.username,
      password: data.password,
      selectedCalendarUrls: data.selected_calendar_urls || [],
      syncIntervalMinutes: data.sync_interval_minutes || 60,
      enabled: data.enabled,
      lastSyncAt: data.last_sync_at,
    };
  } catch (err: any) {
    console.error('Unexpected error fetching CalDAV sync settings:', err);
    return null;
  }
};

export const deleteCalDAVSyncSettings = async (): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  console.log("Deleting CalDAV settings for user:", user.id);
  const { error } = await supabase
    .from('caldav_sync_settings')
    .delete()
    .eq('user_id', user.id); // Assuming RLS allows deleting own records

  if (error) {
    console.error('Error deleting CalDAV settings:', error);
    return false;
  }
  return true;
};

export const saveCalDAVSyncSettings = async (settings: {
  serverUrl: string;
  username: string;
  password: string;
  selectedCalendarUrls: string[];
  syncIntervalMinutes?: number;
}): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from('caldav_sync_settings')
    .upsert({
      user_id: user.id,
      server_url: settings.serverUrl,
      username: settings.username,
      password: settings.password,
      selected_calendar_urls: settings.selectedCalendarUrls,
      sync_interval_minutes: settings.syncIntervalMinutes || 60,
      enabled: true,
      last_sync_at: null,
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    console.error('Error saving CalDAV sync settings:', error);
    return false;
  }
  return true;
};

export const updateLastSyncTime = async (): Promise<void> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('caldav_sync_settings')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('user_id', user.id);
};

export const deleteAllCalDAVData = async (): Promise<boolean> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // 1. 설정 삭제
  const { error: settingsError } = await supabase
    .from('caldav_sync_settings')
    .delete()
    .eq('user_id', user.id);

  if (settingsError) {
    console.error('Error deleting sync settings:', settingsError);
    return false;
  }

  // 2. CalDAV 이벤트 삭제
  const { error: eventsError } = await supabase
    .from('events')
    .delete()
    .eq('source', 'caldav'); // RLS가 적용되어 있어 내 데이터만 삭제됨

  if (eventsError) {
    console.error('Error deleting CalDAV events:', eventsError);
    return false;
  }
  
  return true;
};

// 중복 이벤트 체크
export const eventExists = async (
  event: Omit<Event, 'id'>,
  calendarUrl?: string | null,
  source: string = 'caldav'
): Promise<boolean> => {
  const normalizedCalendarUrl = normalizeCalendarUrl(calendarUrl);

  const query = supabase
    .from('events')
    .select('id')
    .eq('title', event.title)
    .eq('date', event.date)
    .in('source', [source, null]) // 과거에 source가 null인 caldav 데이터도 중복 체크
    .limit(1);

  // start_time과 end_time도 비교 (null 처리)
  if (event.startTime) {
    query.eq('start_time', event.startTime);
  } else {
    query.is('start_time', null);
  }

  if (event.endTime) {
    query.eq('end_time', event.endTime);
  } else {
    query.is('end_time', null);
  }

  if (normalizedCalendarUrl) {
    query.eq('calendar_url', normalizedCalendarUrl);
  }

  const { data, error } = await query.maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error checking event existence:', error);
    return false;
  }

  return data !== null;
};

// 중복 이벤트 삭제
export const deleteDuplicateEvents = async (): Promise<number> => {
  // 모든 이벤트 가져오기
  const { data: events, error: fetchError } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: true });

  if (fetchError || !events) {
    console.error('Error fetching events for deduplication:', fetchError);
    return 0;
  }

  // 중복 찾기 (제목, 날짜, 시작 시간, 종료 시간이 모두 같은 경우)
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const event of events) {
    const normalizedCalendarUrl = normalizeCalendarUrl(event.calendar_url || event.calendarUrl || null) || '';
    const source = event.source || '';

    // caldav_uid 우선 기준
    if (event.caldav_uid) {
      const key = `uid|${event.caldav_uid}|${normalizedCalendarUrl}`;
      if (seen.has(key)) {
        duplicates.push(event.id);
      } else {
        seen.add(key);
      }
      continue;
    }

    // 중복 체크 키 생성 (제목|날짜|시작시간|종료시간)
    const startTime = event.start_time || '';
    const endTime = event.end_time || '';
    const key = `meta|${event.title}|${event.date}|${startTime}|${endTime}|${normalizedCalendarUrl}|${source}`;
    
    if (seen.has(key)) {
      duplicates.push(event.id);
    } else {
      seen.add(key);
    }
  }

  // 중복 삭제 (배치로 처리)
  if (duplicates.length > 0) {
    const batchSize = 50;
    let deletedCount = 0;
    
    for (let i = 0; i < duplicates.length; i += batchSize) {
      const batch = duplicates.slice(i, i + batchSize);
      const { error: deleteError } = await supabase
        .from('events')
        .delete()
        .in('id', batch);

      if (deleteError) {
        console.error(`Error deleting duplicate batch ${Math.floor(i / batchSize) + 1}:`, deleteError);
        continue;
      }
      
      deletedCount += batch.length;
    }
    
    return deletedCount;
  }

  return 0;
};
