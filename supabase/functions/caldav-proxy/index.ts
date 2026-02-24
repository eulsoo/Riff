// Supabase Edge Function: CalDAV Proxy
// CORS 문제를 해결하기 위한 백엔드 프록시

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
declare const Deno: any;

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

// Base64 인코딩/디코딩 헬퍼
function base64Encode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64Decode(str: string): string {
  return decodeURIComponent(escape(atob(str)));
}

// 암호화/복호화 (AES-GCM)
async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("caldav-salt"), // 고정 솔트 (단순화)
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPassword(password: string, secret: string): Promise<string> {
  const key = await getCryptoKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(password);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  
  // IV와 암호문을 합쳐서 반환 (Format: iv:ciphertext in base64)
  const ivBase64 = btoa(String.fromCharCode(...iv));
  const contentBase64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return `${ivBase64}:${contentBase64}`;
}

async function decryptPassword(encryptedStr: string, secret: string): Promise<string> {
  const [ivBase64, contentBase64] = encryptedStr.split(':');
  if (!ivBase64 || !contentBase64) throw new Error('Invalid encrypted format');
  
  const key = await getCryptoKey(secret);
  const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  const encrypted = Uint8Array.from(atob(contentBase64), c => c.charCodeAt(0));
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted
  );
  
  return new TextDecoder().decode(decrypted);
}

// 리다이렉트 처리용 Fetch 래퍼 (Authorization 헤더 유지)
async function fetchWithRedirect(url: string, options: RequestInit, maxRedirects = 5): Promise<Response> {
  if (maxRedirects === 0) {
    throw new Error('Too many redirects');
  }
  
  const newOptions = { ...options, redirect: 'manual' as RequestRedirect };
  const response = await fetch(url, newOptions);
  
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    const location = response.headers.get('location')!;
    const nextUrl = location.startsWith('http') ? location : new URL(location, url).toString();
    console.log(`리다이렉트 팔로우: ${url} -> ${nextUrl}`);
    
    return fetchWithRedirect(nextUrl, newOptions, maxRedirects - 1);
  }
  
  return response;
}

interface CalDAVRequest {
  serverUrl: string;
  username: string;
  password: string;
  action: 'listCalendars' | 'fetchEvents' | 'getSyncToken' | 'syncCollection' | 'createEvent' | 'updateEvent' | 'deleteEvent' | 'saveSettings' | 'loadSettings' | 'createCalendar' | 'deleteCalendar';
  calendarUrl?: string;
  startDate?: string;
  endDate?: string;
  syncToken?: string;
  eventData?: string; // ICS content for PUT
  eventUid?: string;  // Resource filename (e.g. uid.ics) for PUT/DELETE
  etag?: string;      // For If-Match
  settingId?: string; // DB 저장된 설정 ID
  calendarName?: string;     // For createCalendar
  calendarColor?: string;    // For createCalendar
}

interface Calendar {
  displayName: string;
  url: string;
  ctag?: string;
  isShared?: boolean;
  isSubscription?: boolean;
  readOnly?: boolean;
}

interface Event {
  date: string;
  endDate?: string; // 여러 날에 걸치는 종일 일정의 종료일
  title: string;
  memo?: string;
  startTime?: string;
  endTime?: string;
  color: string;
  uid?: string;  // CalDAV UID 추가
  etag?: string; // ETag 추가
}

Deno.serve(async (req) => {
  // CORS 헤더 설정
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  // OPTIONS 요청 처리 (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // verify_jwt: false 상태에서 수동으로 JWT 검증
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: '인증 헤더가 없습니다.' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: '서버 설정 오류(SUPABASE_URL/ANON_KEY).' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const token = authHeader.slice('Bearer '.length);
  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });
    if (!authRes.ok) {
      const authBody = await authRes.text();
      return new Response(
        JSON.stringify({ error: '인증 토큰이 유효하지 않습니다.', details: authBody }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: `인증 확인 실패: ${error?.message || 'unknown error'}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    console.log('요청 받음:', req.method);
    const requestData: CalDAVRequest = await req.json();
    console.log('요청 데이터:', { 
      serverUrl: requestData.serverUrl, 
      username: requestData.username ? '***' : undefined,
      action: requestData.action 
    });

    const { action, calendarUrl, startDate, endDate, settingId, userTimezone } = requestData;
    let { serverUrl, username, password } = requestData;

    // 사용자 timezone offset 계산 (UTC 이벤트 변환 시 사용)
    const userTzOffsetMinutes = userTimezone ? getOffsetMinutesForTimezone(userTimezone) : 9 * 60; // 기본 KST


    // 만약 settingId가 제공되었다면 DB에서 보안 설정 조회
    if (settingId) {
       // 인증된 클라이언트 생성 (Service Role Key 필요할 수도 있음 -> RLS 우회 필요하면)
       // 하지만 사용자 데이터이므로 Auth Header 사용이 맞음.
       const supabaseClient = createClient(
          supabaseUrl!,
          supabaseAnonKey!,
          { global: { headers: { Authorization: authHeader } } }
       );

       const { data: settings, error: settingsError } = await supabaseClient
          .from('caldav_sync_settings')
          .select('server_url, username, password')
          .eq('id', settingId)
          .single();

       if (settingsError || !settings) {
          console.error('설정 조회 실패:', settingsError);
          return new Response(
            JSON.stringify({ error: '설정 정보를 찾을 수 없습니다.' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
       }
       
       serverUrl = settings.server_url;
       username = settings.username;
       
       // 요청에 비밀번호가 명시적으로 포함되어 있다면 저장된 비밀번호보다 우선 사용
       if (requestData.password) {
         console.log('요청에 포함된 새 비밀번호를 사용합니다.');
       } else {
         // 저장된 비밀번호 복호화
         // 만약 암호화되지 않은 구형 데이터라면 그대로 사용 (호환성)
         if (settings.password && settings.password.includes(':')) {
            try {
              const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'fallback-secret-key';
              password = await decryptPassword(settings.password, serviceRoleKey);
              console.log(`[DEBUG] 복호화 완료: 길이=${password ? password.length : 0}`);
            } catch (e) {
              console.warn('복호화 실패, 평문으로 시도:', e);
              password = settings.password;
            }
         } else {
            password = settings.password;
         }
       }
    }

    if (action === 'saveSettings') {
        const { serverUrl, username, password } = requestData;
        if (!serverUrl || !username || !password) {
            return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: corsHeaders });
        }
        
        const supabaseClient = createClient(
           supabaseUrl!,
           supabaseAnonKey!,
           { global: { headers: { Authorization: authHeader } } }
        );
        
        // 비밀번호 암호화
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'fallback-secret-key';
        const encryptedPassword = await encryptPassword(password, serviceRoleKey);
        
        const { data: authUser } = await supabaseClient.auth.getUser(token);
        if (!authUser.user) throw new Error('User not found');
        
        // 기존 설정 모두 삭제 (중복 데이터 정리)
        await supabaseClient
            .from('caldav_sync_settings')
            .delete()
            .eq('user_id', authUser.user.id);

        // 신규 생성
        const { data, error } = await supabaseClient
            .from('caldav_sync_settings')
            .insert({ 
                user_id: authUser.user.id,
                server_url: serverUrl,
                username: username,
                password: encryptedPassword,
                selected_calendar_urls: [], // 기본값 빈 배열 추가
                updated_at: new Date().toISOString()
            })
            .select()
            .single();
           
        if (error) throw error;
        
        return new Response(JSON.stringify({ success: true, settingId: data.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'loadSettings') {
       const supabaseClient = createClient(
          supabaseUrl!,
          supabaseAnonKey!,
          { global: { headers: { Authorization: authHeader } } }
       );
       const { data: authUser } = await supabaseClient.auth.getUser(token);
        
       const { data, error } = await supabaseClient
          .from('caldav_sync_settings')
          .select('id, server_url, username, password')
          .eq('user_id', authUser.user!.id)
          .maybeSingle(); // 없으면 null
          
       if (error) throw error;
       
       if (!data) {
           return new Response(JSON.stringify({ exists: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
       }
       
       return new Response(JSON.stringify({
           exists: true,
           settingId: data.id,
           serverUrl: data.server_url,
           username: data.username,
           hasPassword: !!data.password // 비밀번호 존재 여부만 전달
       }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // settingId가 있거나 loadSettings 액션인 경우 필수 파라미터 검사 완화
    if ((!serverUrl || !username || !password) && action !== 'loadSettings' && !settingId) {
      console.error('필수 파라미터 누락:', { serverUrl: !!serverUrl, username: !!username, password: !!password, action: !!action });
      return new Response(
        JSON.stringify({ error: '필수 파라미터가 누락되었습니다.' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let result;

    try {
      if (action === 'listCalendars') {
        console.log('캘린더 목록 가져오기 시작');
        result = await fetchCalendars(serverUrl, username, password);
        console.log('캘린더 목록 가져오기 완료:', result.length);
      } else if (action === 'fetchEvents') {
        if (!calendarUrl) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        console.log('이벤트 가져오기 시작');
        result = await fetchCalendarEvents(serverUrl, username, password, calendarUrl, startDate, endDate, userTzOffsetMinutes);
        console.log('이벤트 가져오기 완료:', result.length);
      } else if (action === 'getSyncToken') {
        if (!calendarUrl) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        console.log('sync-token 가져오기 시작');
        result = await fetchSyncToken(serverUrl, username, password, calendarUrl);
        console.log('sync-token 가져오기 완료');
      } else if (action === 'syncCollection') {
        if (!calendarUrl) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        if (!requestData.syncToken) {
          return new Response(
            JSON.stringify({ error: 'syncToken이 필요합니다.' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        console.log('sync-collection 시작');
        result = await fetchSyncCollection(serverUrl, username, password, calendarUrl, requestData.syncToken);
        console.log('sync-collection 완료');
      } else if (action === 'createEvent' || action === 'updateEvent') {
        if (!calendarUrl || !requestData.eventData || !requestData.eventUid) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl, eventData, eventUid가 필요합니다.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log(`${action} 시작:`, requestData.eventUid);
        result = await putEvent(serverUrl, username, password, calendarUrl, requestData.eventUid, requestData.eventData, requestData.etag);
        console.log(`${action} 완료`);
      } else if (action === 'deleteEvent') {
        if (!calendarUrl || !requestData.eventUid) {
           return new Response(
            JSON.stringify({ error: 'calendarUrl, eventUid가 필요합니다.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
         console.log('deleteEvent 시작:', requestData.eventUid);
        // Correctly map arguments to deleteEvent(server, user, pass, calUrl, syncToken, eventData, eventUid, etag, settingId)
        result = await deleteEvent(serverUrl, username, password, calendarUrl, undefined, undefined, requestData.eventUid, requestData.etag, settingId); 
        console.log('deleteEvent 완료');
      } else if (action === 'createCalendar') {
        if (!requestData.calendarName) {
          return new Response(
            JSON.stringify({ error: 'calendarName이 필요합니다.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log('createCalendar 시작:', requestData.calendarName);
        result = await createCalendarOnServer(serverUrl, username, password, requestData.calendarName, requestData.calendarColor);
        console.log('createCalendar 완료:', result);
      } else if (action === 'deleteCalendar') {
        if (!calendarUrl) {
          return new Response(
            JSON.stringify({ error: 'calendarUrl이 필요합니다.' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        console.log('deleteCalendar 시작:', calendarUrl);
        // 캘린더 삭제는 캘린더 URL에 DELETE 요청
        const cleanUsername = username.trim();
        const cleanPassword = password.trim();
        
        const response = await fetchWithRedirect(calendarUrl, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${base64Encode(`${cleanUsername}:${cleanPassword}`)}`,
            'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
          },
        });
        
        if (!response.ok) {
           throw new Error(`캘린더 삭제 실패: ${response.status} ${response.statusText}`);
        }
        
        result = { success: true };
        console.log('deleteCalendar 완료');
      } else {
        return new Response(
          JSON.stringify({ error: '지원하지 않는 액션입니다.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } catch (fetchError: any) {
    console.error('fetchCalendars/fetchCalendarEvents 오류:', fetchError);
      throw fetchError;
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('CalDAV 프록시 오류:', error);
    console.error('오류 스택:', error.stack);
    console.error('오류 타입:', typeof error);
    console.error('오류 메시지:', error.message);
    
    const errorResponse = {
      error: error.message || 'CalDAV 요청 처리 중 오류가 발생했습니다.',
      details: error.toString(),
      ...(error.stack && { stack: error.stack })
    };
    
    return new Response(
      JSON.stringify(errorResponse),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// 캘린더 목록 가져오기 (PROPFIND 요청)
async function fetchCalendars(serverUrl: string, username: string, password: string): Promise<Calendar[]> {
  console.log('fetchCalendars 시작:', serverUrl);

  // 1. Discovery 시작 (.well-known/caldav)
  // 불확실한 사용자명 기반 추측 로직(/calendars/user/)은 제거하고 표준 Discovery를 따름.
  
  // URL 정규화 (끝에 슬래시 제거)
  const normalizedServerUrl = serverUrl.replace(/\/+$/, '');
  const wellKnownUrl = `${normalizedServerUrl}/.well-known/caldav`;

  console.log('Discovery 시작 (PROPFIND):', wellKnownUrl);

  const cleanUsername = username.trim();
  const cleanPassword = password.trim();

  // Pre-flight GET request to warm up auth
  try {
    console.log('Pre-flight auth check...');
    await fetchWithRedirect(normalizedServerUrl + '/', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${base64Encode(`${cleanUsername}:${cleanPassword}`)}`,
        'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
      },
    });
  } catch (e) {
    console.warn('Pre-flight check warning (ignoring):', e);
  }

  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop>
    <current-user-principal/>
  </prop>
</propfind>`;

  try {
    const response = await fetchWithRedirect(wellKnownUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${cleanUsername}:${cleanPassword}`)}`,
        'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
      },
      body: propfindBody,
    });

    if (!response.ok && response.status !== 207) {
      console.error(`Discovery 실패: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error('Error Body:', errorText.substring(0, 500));
      const authHeader = response.headers.get('www-authenticate') || 'None';
      if (response.status === 401) {
         throw new Error('애플 계정 인증에 실패했습니다. 올바른 앱 전용 비밀번호(예: aaaa-bbbb-cccc-dddd)를 입력했는지 확인해주세요. (일반 Apple ID 암호를 사용하면 로그인할 수 없습니다)');
      }
      throw new Error(`캘린더 서버 연결 실패: ${response.url} (HTTP ${response.status}), Auth-Header: ${authHeader}`);
    }

    // 리다이렉트된 최종 URL의 Origin을 Base URL로 사용
    // (예: https://caldav.icloud.com -> https://p48-caldav.icloud.com)
    const finalUrlObj = new URL(response.url);
    let baseUrl = `${finalUrlObj.protocol}//${finalUrlObj.host}`;
    console.log('Base URL updated to:', baseUrl);

    const xmlText = await response.text();
    
    // principal URL 추출
    const principalMatch = xmlText.match(/<current-user-principal[^>]*>[\s\S]*?<href>([^<]+)<\/href>/i) ||
                            xmlText.match(/href[^>]*>([^<]+principal[^<]+)</i);
    
    if (!principalMatch) {
      throw new Error('사용자 Principal URL을 찾을 수 없습니다.');
    }
    
    const principalPath = principalMatch[1]; // 예: /12345/principal/
    const principalUrl = principalPath.startsWith('http') 
      ? principalPath 
      : `${baseUrl}${principalPath.startsWith('/') ? principalPath : '/' + principalPath}`;
    
    console.log('Principal URL:', principalUrl);
    
    // Principal URL에서 캘린더 홈 찾기
    const calendarHomeBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <prop>
    <cal:calendar-home-set/>
  </prop>
</propfind>`;
    
    const principalResponse = await fetchWithRedirect(principalUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${cleanUsername}:${cleanPassword}`)}`,
        'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
      },
      body: calendarHomeBody,
    });
    
    if (!principalResponse.ok && principalResponse.status !== 207) {
      const authHeader = principalResponse.headers.get('www-authenticate') || 'None';
      throw new Error(`Principal 상세 조회 실패: HTTP ${principalResponse.status}, Auth: ${authHeader}`);
    }

    // 만약 Principal 요청이 리다이렉트되었다면, Base URL을 업데이트 (Shard 이동)
    const finalPrincipalUrlObj = new URL(principalResponse.url);
    const newBaseUrl = `${finalPrincipalUrlObj.protocol}//${finalPrincipalUrlObj.host}`;
    if (newBaseUrl !== baseUrl) {
      console.log(`Base URL updated from Principal redirect: ${baseUrl} -> ${newBaseUrl}`);
      baseUrl = newBaseUrl;
    }
    
    const principalXml = await principalResponse.text();
    
    // calendar-home-set URL 추출
    const calendarHomeMatch = principalXml.match(/<calendar-home-set[^>]*>[\s\S]*?<href>([^<]+)<\/href>/i) ||
                               principalXml.match(/calendar-home-set[^>]*>[\s\S]*?href[^>]*>([^<]+)</i);
    
    if (!calendarHomeMatch) {
      // calendar-home-set이 없으면 principal URL에서 직접 캘린더 찾기 시도
      console.log('calendar-home-set 없음, Principal URL에서 캘린더 조회 시도');
      return await fetchCalendarsFromPath(principalUrl, baseUrl, username, password);
    }
    
    const calendarHomePath = calendarHomeMatch[1];
    const calendarHomeUrl = calendarHomePath.startsWith('http')
      ? calendarHomePath
      : `${baseUrl}${calendarHomePath.startsWith('/') ? calendarHomePath : '/' + calendarHomePath}`;
    
    console.log('Calendar Home URL:', calendarHomeUrl);
    
    return await fetchCalendarsFromPath(calendarHomeUrl, baseUrl, username, password);

  } catch (error: any) {
    console.error('fetchCalendars 실패:', error);
    throw error;
  }
}

// 특정 경로에서 캘린더 목록 가져오기
async function fetchCalendarsFromPath(pathUrl: string, baseUrl: string, username: string, password: string): Promise<Calendar[]> {
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
  <prop>
    <displayname/>
    <resourcetype/>
    <apple:calendar-color/>
    <cal:calendar-color/>
  </prop>
</propfind>`;

  console.log('캘린더 경로에서 PROPFIND:', pathUrl);
  
  const response = await fetchWithRedirect(pathUrl, {
    method: 'PROPFIND',
    headers: {
      'Content-Type': 'application/xml',
      'Depth': '1',
      'Authorization': `Basic ${base64Encode(`${username.trim()}:${password.trim()}`)}`,
      'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
    },
    body: propfindBody,
  });

  console.log('캘린더 경로 응답 상태:', response.status);

  if (!response.ok && response.status !== 207) {
    const errorText = await response.text();
    console.error('캘린더 경로 오류:', errorText.substring(0, 500));
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const xmlText = await response.text();
  console.log('캘린더 경로 XML 길이:', xmlText.length);
  console.log('캘린더 경로 XML 시작:', xmlText.substring(0, 2000));
  
  const calendars = parseCalendarsFromXML(xmlText, baseUrl);
  
  if (calendars.length === 0) {
    throw new Error('캘린더를 찾을 수 없습니다. iCloud에서 캘린더가 활성화되어 있는지 확인해주세요.');
  }
  
  return calendars;
}

// XML에서 캘린더 목록 파싱
function parseCalendarsFromXML(xmlText: string, baseUrl: string): Calendar[] {
  const calendars: Calendar[] = [];
  
  console.log('XML 파싱 시작, 텍스트 길이:', xmlText.length);
  
  // 여러 네임스페이스 형식 지원
  // <d:response>, <response>, <D:response> 등
  const responseRegex = /<(?:d:)?response[^>]*>([\s\S]*?)<\/(?:d:)?response>/gi;
  let match;

  while ((match = responseRegex.exec(xmlText)) !== null) {
    const responseXml = match[1];
    
    // href 추출 (여러 형식 지원)
    const hrefMatch = responseXml.match(/<(?:d:)?href[^>]*>([^<]+)<\/(?:d:)?href>/i);
    if (!hrefMatch) {
      // 다른 형식 시도
      const hrefMatch2 = responseXml.match(/href[^>]*>([^<]+)</i);
      if (!hrefMatch2) continue;
      var href = hrefMatch2[1];
    } else {
      var href = hrefMatch[1];
    }
    
    // displayname 추출 (여러 형식 지원)
    const displayNameMatch = responseXml.match(/<(?:d:)?displayname[^>]*>([^<]+)<\/(?:d:)?displayname>/i);
    let displayName = 'Unknown';
    
    if (displayNameMatch && displayNameMatch[1]) {
      displayName = displayNameMatch[1];
    } else {
      // fallback: href의 마지막 부분을 이름으로 사용
      // 끝에 있는 슬래시 제거 후 마지막 부분 추출
      const cleanHref = href.replace(/\/+$/, '');
      const parts = cleanHref.split('/');
      if (parts.length > 0) {
        displayName = parts[parts.length - 1].replace(/%20/g, ' ').replace(/%2F/g, '/');
      }
    }
    
    // calendar 리소스 타입인지 확인
    // <cal:calendar>, <calendar>, <C:calendar> 등
    const isCalendar = /<(?:cal:)?calendar[^>]*>/i.test(responseXml) || 
                       /resourcetype[^>]*>[\s\S]*?<(?:cal:)?calendar/i.test(responseXml) ||
                       href.includes('calendar');
    
    if (isCalendar || href.match(/calendar/i)) {
      // URL 정규화 - 항상 baseUrl의 host를 사용 (shard URL 보장)
      let fullUrl: string;
      if (href.startsWith('http')) {
        // 절대 URL이어도 baseUrl의 host로 교체 (gateway -> shard)
        try {
          const hrefUrlObj = new URL(href);
          const baseUrlObj = new URL(baseUrl);
          // path만 추출하여 baseUrl의 host와 결합
          fullUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${hrefUrlObj.pathname}`;
          console.log(`URL 변환: ${href} -> ${fullUrl}`);
        } catch {
          fullUrl = href; // 파싱 실패시 원본 사용
        }
      } else if (href.startsWith('/')) {
        fullUrl = `${baseUrl}${href}`;
      } else {
        fullUrl = `${baseUrl}/${href}`;
      }
      
      
      // 색상 추출
      const color = parseColorFromXml(responseXml);
      
      calendars.push({
        displayName: decodeURIComponent(displayName),
        url: fullUrl,
        color: color || undefined,
        isShared: checkIsShared(responseXml, fullUrl),
        isSubscription: fullUrl.endsWith('.ics') || /subscribed/i.test(responseXml),
        readOnly: checkReadOnly(responseXml),
      });
      
      console.log('캘린더 발견:', displayName, fullUrl, color);
    }
  }

  console.log('총 파싱된 캘린더:', calendars.length);
  return calendars;
}

// 색상 파싱 헬퍼
function parseColorFromXml(xmlText: string): string | null {
  const appleColorMatch = xmlText.match(/<(?:[a-zA-Z0-9]+:)?calendar-color[^>]*>([^<]+)<\//i) ||
                          xmlText.match(/calendar-color[^>]*>([^<]+)</i);
  
  if (appleColorMatch) {
    return appleColorMatch[1].trim();
  }
  return null;
}

function checkIsShared(xml: string, url: string): boolean {
  // 1. URL 해시값 확인 (64자 이상 hex string, 하이픈 없음) -> 공유받은 캘린더
  // 예: .../calendars/7cb9a57f805e8aa1a...
  const parts = url.replace(/\/$/, '').split('/');
  const lastPart = parts[parts.length - 1];
  
  // UUID (36자, 하이픈 포함) 제외하고 60자 이상이면 공유받은 것으로 본다.
  if (lastPart.length >= 60 && !lastPart.includes('-') && /^[0-9a-fA-F]+$/.test(lastPart)) {
    return true;
  }

  return false;
}

function checkReadOnly(xml: string): boolean {
  // 1. resourcetype이 subscribed인 경우 읽기 전용으로 간주
  if (/<(?:cs:)?subscribed[^>]*\/>/i.test(xml) || /<subscribed[^>]*\/>/i.test(xml)) {
    return true;
  }
  
  // 2. 권한 확인 (current-user-privilege-set)
  // write 권한이 없으면 읽기 전용
  // 하지만 복잡하므로 간단히 smart check
  return false;
}

// 캘린더 색상 조회 (PROPFIND)
async function fetchCalendarColor(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string
): Promise<string | null> {
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:apple="http://apple.com/ns/ical/">
  <prop>
    <apple:calendar-color/>
    <c:calendar-color/>
  </prop>
</propfind>`;

  try {
    const response = await fetchWithRedirect(calendarUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${username.trim()}:${password.trim()}`)}`,
        'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
      },
      body: propfindBody,
    });

    if (!response.ok) return null;
    const xmlText = await response.text();
    return parseColorFromXml(xmlText);
  } catch (error) {
    console.error('색상 조회 실패:', error);
    return null;
  }
}

// 캘린더 이벤트 가져오기 (REPORT 요청)
async function fetchCalendarEvents(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  startDate?: string,
  endDate?: string,
  userTzOffsetMinutes: number = 9 * 60
): Promise<Omit<Event, 'id'>[]> {
  console.log('fetchCalendarEvents 시작:', calendarUrl);
  
  // 1. 캘린더 색상 먼저 조회
  const calendarColor = await fetchCalendarColor(serverUrl, username, password, calendarUrl);
  console.log('캘린더 색상:', calendarColor);

  // 날짜 범위 설정 (기본값: 최근 1년 전부터 1년 후까지)
  const start = startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const end = endDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log('날짜 범위:', start, '~', end);

  // CALDAV REPORT 요청 본문
  const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${start}T00:00:00Z" end="${end}T23:59:59Z"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  try {
    console.log('REPORT 요청 시작:', calendarUrl);
    const response = await fetchWithRedirect(calendarUrl, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
        'Authorization': `Basic ${base64Encode(`${username.trim()}:${password.trim()}`)}`,
        'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
      },
      body: reportBody,
    });

    console.log('REPORT 응답 상태:', response.status, response.statusText);

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text();
      console.error('REPORT 오류 응답:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    // 캘린더 색상과 사용자 timezone을 함께 전달
    const events = parseEventsFromXML(xmlText, calendarColor || '#3b82f6', userTzOffsetMinutes);
    console.log('파싱된 이벤트 수:', events.length);
    
    return events;
  } catch (error: any) {
    console.error('fetchCalendarEvents 오류:', error);
    throw new Error(`이벤트를 가져올 수 없습니다: ${error.message}`);
  }
}

// sync-token 가져오기 (PROPFIND)
async function fetchSyncToken(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string
): Promise<{ syncToken: string | null }> {
  try {
    const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<propfind xmlns="DAV:">
  <prop>
    <sync-token/>
  </prop>
</propfind>`;

    const response = await fetchWithRedirect(calendarUrl, {
      method: 'PROPFIND',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '0',
        'Authorization': `Basic ${base64Encode(`${username.trim()}:${password.trim()}`)}`,
        'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
      },
      body: propfindBody,
    });

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text();
      console.error('PROPFIND(sync-token) 오류 응답:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const tokenMatch = xmlText.match(/<sync-token[^>]*>([\s\S]*?)<\/sync-token>/i);
    const syncToken = tokenMatch ? tokenMatch[1].trim() : null;
    return { syncToken };
  } catch (error: any) {
    console.error('fetchSyncToken 오류:', error);
    return { syncToken: null };
  }
}

// sync-collection REPORT (변경분만 가져오기)
async function fetchSyncCollection(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  syncToken: string
): Promise<{ events: Omit<Event, 'id'>[]; syncToken: string | null; hasDeletions: boolean }> {
  // 1. 캘린더 색상 조회 (캐싱 없으므로 매번 조회)
  const calendarColor = await fetchCalendarColor(serverUrl, username, password, calendarUrl);

  const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<sync-collection xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <sync-token>${syncToken}</sync-token>
  <sync-level>1</sync-level>
  <prop>
    <getetag/>
    <c:calendar-data/>
  </prop>
</sync-collection>`;

  try {
    const response = await fetchWithRedirect(calendarUrl, {
      method: 'REPORT',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Depth': '1',
        'Authorization': `Basic ${base64Encode(`${username.trim()}:${password.trim()}`)}`,
        'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
      },
      body: reportBody,
    });

    if (!response.ok && response.status !== 207) {
      const errorText = await response.text();
      console.error('REPORT(sync-collection) 오류 응답:', errorText.substring(0, 500));
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    let events = parseEventsFromXML(xmlText, calendarColor || '#3b82f6');
    const nextTokenMatch = xmlText.match(/<sync-token[^>]*>([\s\S]*?)<\/sync-token>/i);
    const nextSyncToken = nextTokenMatch ? nextTokenMatch[1].trim() : null;

    // 삭제 여부 감지 (404/410 응답이 있으면 삭제로 판단)
    const hasDeletions = /HTTP\/1\.1\s+(404|410)/i.test(xmlText);

    console.log('sync-collection 응답 길이:', xmlText.length);
    console.log('sync-collection next token:', nextSyncToken ? nextSyncToken.substring(0, 12) + '...' : 'none');

    // calendar-data가 없으면 href로 개별 이벤트를 가져온다
    if (events.length === 0) {
      const hrefs = extractChangedHrefs(xmlText, calendarUrl);
      console.log('sync-collection hrefs:', hrefs.length);
      if (hrefs.length > 0) {
        const fetched = await fetchEventsByHrefs(username, password, calendarUrl, hrefs, calendarColor || '#3b82f6');
        console.log('sync-collection href fetch events:', fetched.length);
        if (fetched.length > 0) {
          events = fetched;
        }
      }
    }

    return { events, syncToken: nextSyncToken, hasDeletions };
  } catch (error: any) {
    console.error('fetchSyncCollection 오류:', error);
    throw new Error(`sync-collection 실패: ${error.message}`);
  }
}

function extractChangedHrefs(xmlText: string, calendarUrl: string): string[] {
  const hrefs: string[] = [];
  const responseRegex = /<(?:d:)?response[^>]*>([\s\S]*?)<\/(?:d:)?response>/gi;
  let match;
  const calendarPath = calendarUrl.replace(/\/+$/, '');

  while ((match = responseRegex.exec(xmlText)) !== null) {
    const responseXml = match[1];
    const statusMatch = responseXml.match(/<status[^>]*>([^<]+)<\/status>/i);
    const statusText = statusMatch ? statusMatch[1] : '';
    if (!/200\s+OK/i.test(statusText)) {
      continue;
    }

    const hrefMatch = responseXml.match(/<(?:d:)?href[^>]*>([^<]+)<\/(?:d:)?href>/i);
    if (!hrefMatch) continue;

    const href = hrefMatch[1].trim();
    if (!href || href.endsWith('/')) continue;

    // 캘린더 컬렉션 href는 제외
    if (href.includes(calendarPath)) {
      // calendarUrl 자체가 포함된 경우도 많아서, 파일로 추정되는 것만 허용
      if (!href.match(/\.ics$/i)) {
        continue;
      }
    }

    hrefs.push(href);
  }

  return hrefs;
}

function buildAbsoluteUrl(calendarUrl: string, href: string): string {
  if (href.startsWith('http')) return href;
  const base = new URL(calendarUrl);
  if (href.startsWith('/')) {
    return `${base.origin}${href}`;
  }
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return `${base.origin}${basePath}${href}`;
}

async function fetchEventsByHrefs(
  username: string,
  password: string,
  calendarUrl: string,
  hrefs: string[],
  defaultColor: string
): Promise<Omit<Event, 'id'>[]> {
  const events: Omit<Event, 'id'>[] = [];
  for (const href of hrefs) {
    try {
      const absoluteUrl = buildAbsoluteUrl(calendarUrl, href);
      const response = await fetchWithRedirect(absoluteUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
          'User-Agent': 'macOS/14.0 (23A344) CalendarAgent/988',
        },
      });
      if (!response.ok) continue;
      const icalText = await response.text();
// ... existing code ...
    } catch (error) {
       console.error('fetchEventsByHrefs error:', error);
    }
  }
  return events;
}

// ----------------------------------------------------------------------------
// Create / Update Event (PUT)
// ----------------------------------------------------------------------------
async function putEvent(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  eventUid: string,
  eventData: string,
  etag?: string
): Promise<{ success: boolean; etag?: string }> {
  // Ensure calendarUrl ends with /
  const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
  // Filename usually is UID.ics
  const filename = eventUid.endsWith('.ics') ? eventUid : `${eventUid}.ics`;
  const url = `${base}${filename}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
    'User-Agent': 'macOS/14.0 (23A344) CalendarAgent/988',
  };

  if (etag) {
    headers['If-Match'] = `"${etag}"`; // Some servers need quotes
  }

  console.log('PUT requesting:', url);

  const response = await fetchWithRedirect(url, {
    method: 'PUT',
    headers,
    body: eventData,
  });

  if (!response.ok) {
     const text = await response.text();
     console.error('PUT failed:', response.status, text);
     throw new Error(`PUT request failed: ${response.status} ${response.statusText}`);
  }

  const newEtag = response.headers.get('ETag');
  return { success: true, etag: newEtag ? newEtag.replace(/"/g, '') : undefined };
}

// ----------------------------------------------------------------------------
// Delete Event (DELETE)
// ----------------------------------------------------------------------------
async function deleteEvent(
  serverUrl: string,
  username: string,
  password: string,
  calendarUrl: string,
  syncToken?: string,
  eventData?: string,
  eventUid?: string,
  etag?: string,
  settingId?: string // Credentials lookup ID
): Promise<{ success: boolean }> {
  try {
    if (!eventUid) {
      throw new Error('deleteEvent: Error - eventUid is missing/undefined');
    }

    const base = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
    // Ensure eventUid is treated as string
    const safeUid = String(eventUid);
    const filename = safeUid.endsWith('.ics') ? safeUid : `${safeUid}.ics`;
    const url = `${base}${filename}`;

    const headers: Record<string, string> = {
      'Authorization': `Basic ${base64Encode(`${username}:${password}`)}`,
      'User-Agent': 'macOS/14.0 (23A344) CalendarAgent/988',
    };

    if (etag) {
      headers['If-Match'] = `"${etag}"`;
    }

    console.log(`[DELETE] Requesting: ${url}, ETag: ${etag || 'none'}`);
    
    // Explicitly set body to null to prevent Deno 'undefined body' errors
    const response = await fetchWithRedirect(url, {
      method: 'DELETE',
      headers,
      body: null,
    });

    if (!response.ok && response.status !== 404) {
       let text = '';
       try { text = await response.text(); } catch (e) { text = 'Could not read response body'; }
       console.error('[DELETE] Failed:', response.status, text);
       throw new Error(`DELETE request failed: ${response.status} - ${text.substring(0, 100)}`);
    }

    return { success: true };
  } catch (error: any) {
    console.error('[DELETE] Exception caught:', error);
    throw new Error(`DELETE_FUNC_ERROR: ${error.message}`);
  }
}


function parseEventsFromICalText(icalText: string, defaultColor: string, userTzOffsetMinutes: number = 9 * 60): Omit<Event, 'id'>[] {
  const events: Omit<Event, 'id'>[] = [];
  const veventRegex = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  const matches = icalText.match(veventRegex) || [];
  for (const block of matches) {
    const event = parseICalEvent(block, defaultColor, userTzOffsetMinutes);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

// XML에서 이벤트 파싱
function parseEventsFromXML(xmlText: string, defaultColor: string, userTzOffsetMinutes: number = 9 * 60): Omit<Event, 'id'>[] {
  const events: Omit<Event, 'id'>[] = [];
  
  console.log('parseEventsFromXML 시작, XML 길이:', xmlText.length);
  
  // <response> 단위로 순회
  const responseRegex = /<(?:d:)?response[^>]*>([\s\S]*?)<\/(?:d:)?response>/gi;
  let match;
  let matchCount = 0;

  while ((match = responseRegex.exec(xmlText)) !== null) {
    matchCount++;
    const responseBody = match[1];

    // ETag 추출
    const etagMatch = responseBody.match(/<(?:d:)?getetag[^>]*>([\s\S]*?)<\/(?:d:)?getetag>/i);
    let etag = etagMatch ? etagMatch[1].trim() : undefined;
    if (etag) etag = etag.replace(/^"|"$/g, '');

    // Calendar Data 추출
    const calendarDataMatch = responseBody.match(/<(?:c:)?calendar-data[^>]*>([\s\S]*?)<\/(?:c:)?calendar-data>/i);
    
    if (calendarDataMatch) {
      let icalData = calendarDataMatch[1].trim();

      // CDATA 제거
      if (icalData.startsWith('<![CDATA[') && icalData.endsWith(']]>')) {
        icalData = icalData.slice(9, -3).trim();
      }
      
      // HTML 엔티티 디코딩
      icalData = icalData
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      
      try {
        // parseEventsFromICalText 재사용 (배열 반환)
        const parsedList = parseEventsFromICalText(icalData, defaultColor, userTzOffsetMinutes);
        for (const event of parsedList) {
          event.etag = etag; // ETag 주입
          events.push(event);
        }
      } catch (error: any) {
        console.error(`iCal 파싱 오류 (${matchCount}):`, error.message);
      }
    }
  }

  console.log(`총 ${matchCount}개의 response 처리, ${events.length}개의 이벤트 파싱 성공`);
  return events;
}

// IANA 타임존 → UTC 오프셋(분) 매핑
// Edge Function 환경에서는 Intl.DateTimeFormat이 제한적이므로 주요 타임존을 하드코딩
const TIMEZONE_OFFSETS: Record<string, number> = {
  'Asia/Seoul': 540,        // UTC+9
  'Asia/Tokyo': 540,        // UTC+9
  'Asia/Shanghai': 480,     // UTC+8
  'Asia/Hong_Kong': 480,    // UTC+8
  'Asia/Taipei': 480,       // UTC+8
  'Asia/Singapore': 480,    // UTC+8
  'Asia/Kolkata': 330,      // UTC+5:30
  'Asia/Calcutta': 330,     // UTC+5:30
  'Europe/London': 0,       // UTC+0 (DST 미적용 - 간소화)
  'Europe/Paris': 60,       // UTC+1
  'Europe/Berlin': 60,      // UTC+1
  'America/New_York': -300, // UTC-5
  'America/Chicago': -360,  // UTC-6
  'America/Denver': -420,   // UTC-7
  'America/Los_Angeles': -480, // UTC-8
  'US/Eastern': -300,
  'US/Central': -360,
  'US/Mountain': -420,
  'US/Pacific': -480,
  'UTC': 0,
  'GMT': 0,
};

function getTimezoneOffsetMinutes(tzid: string): number | null {
  // 정확한 매칭
  if (tzid in TIMEZONE_OFFSETS) return TIMEZONE_OFFSETS[tzid];
  // 대소문자 무시
  const lower = tzid.toLowerCase();
  for (const [key, val] of Object.entries(TIMEZONE_OFFSETS)) {
    if (key.toLowerCase() === lower) return val;
  }
  return null;
}

// DTSTART/DTEND 전체 라인에서 파라미터(TZID, VALUE 등)와 값을 함께 추출
interface ICalDateTimeParsed {
  dateStr: string;      // YYYY-MM-DD
  timeStr?: string;     // HH:MM (로컬 시간 기준)
  isAllDay: boolean;
  isUtc: boolean;
  tzid?: string;
}

// 타임존 이름으로 UTC 오프셋(분)을 계산 (Intl API 사용 - Deno 환경에서 지원)
function getOffsetMinutesForTimezone(tzName: string): number {
  try {
    // 현재 시각 기준으로 해당 타임존의 오프셋을 계산
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tzName,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0');
    const localDate = new Date(Date.UTC(
      getPart('year'), getPart('month') - 1, getPart('day'),
      getPart('hour') % 24, getPart('minute'), getPart('second')
    ));
    return Math.round((localDate.getTime() - now.getTime()) / 60000);
  } catch {
    // 알 수 없는 타임존이면 TIMEZONE_OFFSETS 맵 fallback
    return getTimezoneOffsetMinutes(tzName) ?? 9 * 60; // 최후 fallback: KST
  }
}

function parseICalDateTime(fullLine: string, userTimezoneOffsetMinutes: number = 9 * 60): ICalDateTimeParsed | null {
  // 전체 라인에서 파라미터와 값 분리
  // 예: DTSTART;TZID=Asia/Seoul:20260226T190000
  // 예: DTSTART;VALUE=DATE:20260226
  // 예: DTSTART:20260226T100000Z
  const colonIdx = fullLine.indexOf(':');
  if (colonIdx === -1) return null;
  
  const params = fullLine.substring(0, colonIdx);     // "DTSTART;TZID=Asia/Seoul" 등
  const value = fullLine.substring(colonIdx + 1).trim(); // "20260226T190000" etc

  // VALUE=DATE 확인 (종일 일정)
  const isAllDay = /VALUE=DATE(?:$|[^-])/i.test(params) || value.length === 8;

  // TZID 추출
  const tzidMatch = params.match(/TZID=([^;:]+)/i);
  const tzid = tzidMatch ? tzidMatch[1] : undefined;

  // UTC(Z 접미사) 여부
  const isUtc = value.endsWith('Z');

  if (isAllDay) {
    // 종일 일정: 날짜 문자열을 그대로 사용 (타임존 변환 불필요)
    const year = value.substring(0, 4);
    const month = value.substring(4, 6);
    const day = value.substring(6, 8);
    return {
      dateStr: `${year}-${month}-${day}`,
      isAllDay: true,
      isUtc: false,
    };
  }

  // 시간 포함 일정
  if (value.length < 15) return null;
  
  const year = parseInt(value.substring(0, 4));
  const month = parseInt(value.substring(4, 6)) - 1;
  const day = parseInt(value.substring(6, 8));
  const hour = parseInt(value.substring(9, 11));
  const minute = parseInt(value.substring(11, 13));

  if (isUtc) {
    // UTC 시간 → 사용자 설정 타임존으로 변환 (appTimezone 반영)
    const utcDate = new Date(Date.UTC(year, month, day, hour, minute));
    const localMs = utcDate.getTime() + userTimezoneOffsetMinutes * 60 * 1000;
    const localDate = new Date(localMs);
    
    return {
      dateStr: `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')}`,
      timeStr: `${String(localDate.getUTCHours()).padStart(2, '0')}:${String(localDate.getUTCMinutes()).padStart(2, '0')}`,
      isAllDay: false,
      isUtc: true,
    };
  }

  if (tzid) {
    // 타임존이 지정된 경우: 해당 타임존의 로컬 시간으로 해석
    // 이미 로컬 시간이므로, 날짜/시간 문자열을 그대로 사용
    return {
      dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      isAllDay: false,
      isUtc: false,
      tzid,
    };
  }

  // 타임존 정보가 없는 경우 (floating time) - 로컬 시간으로 간주
  return {
    dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timeStr: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    isAllDay: false,
    isUtc: false,
  };
}

// iCal 데이터를 Event 형식으로 변환
function parseICalEvent(icalData: string, defaultColor: string, userTzOffsetMinutes: number = 9 * 60): Omit<Event, 'id'> | null {
  try {
    const uidMatch = icalData.match(/UID(?:;.*?)?:([^\r\n]+)/);
    const summaryMatch = icalData.match(/SUMMARY(?:;.*?)?:([^\r\n]+(?:\r?\n [^\r\n]+)*)/);
    const descriptionMatch = icalData.match(/DESCRIPTION(?:;.*?)?:([^\r\n]+(?:\r?\n [^\r\n]+)*)/);
    const colorMatch = icalData.match(/X-APPLE-CALENDAR-COLOR(?:;.*?)?:([^\r\n]+)/);

    // DTSTART/DTEND 전체 라인(파라미터 포함) 추출
    const dtstartLineMatch = icalData.match(/(DTSTART(?:;[^\r\n:]+)?:[^\r\n]+)/);
    const dtendLineMatch = icalData.match(/(DTEND(?:;[^\r\n:]+)?:[^\r\n]+)/);

    if (!dtstartLineMatch) {
      console.log('DTSTART를 찾을 수 없음');
      return null;
    }

    const uid = uidMatch ? uidMatch[1].trim() : undefined;
    const summary = summaryMatch ? summaryMatch[1].replace(/\r?\n /g, '').trim() : '';
    const description = descriptionMatch ? descriptionMatch[1].replace(/\r?\n /g, '').trim() : '';
    const color = colorMatch
      ? `#${colorMatch[1].trim().replace('#', '')}`
      : defaultColor;

    // 날짜/시간 파싱 (타임존 올바르게 처리)
    const startParsed = parseICalDateTime(dtstartLineMatch[1], userTzOffsetMinutes);
    if (!startParsed) return null;

    let endParsed: ICalDateTimeParsed | null = null;
    if (dtendLineMatch) {
      endParsed = parseICalDateTime(dtendLineMatch[1], userTzOffsetMinutes);
    }

    // [DEBUG] 날짜 파싱 결과 로깅
    console.log(`[parseICalEvent] "${summary}" | raw DTSTART: ${dtstartLineMatch[1]} → date:${startParsed.dateStr} time:${startParsed.timeStr || 'none'} allDay:${startParsed.isAllDay}`);

    // 종일 일정의 DTEND 처리:
    // iCal 표준에서 종일 일정의 DTEND는 "exclusive" (예: 3/1 종일 → DTEND=3/2)
    // 여러 날에 걸친 이벤트가 아니면 endDate를 제거
    let endDateStr: string | undefined;
    if (startParsed.isAllDay && endParsed?.isAllDay) {
      // DTEND가 DTSTART+1일이면 단일 종일 일정 → endDate 불필요
      const sd = new Date(startParsed.dateStr + 'T00:00:00Z');
      const ed = new Date(endParsed.dateStr + 'T00:00:00Z');
      const diffDays = Math.round((ed.getTime() - sd.getTime()) / (86400 * 1000));
      if (diffDays > 1) {
        // 여러 날에 걸치는 일정: endDate는 마지막 날 (exclusive이므로 -1일)
        ed.setUTCDate(ed.getUTCDate() - 1);
        endDateStr = ed.toISOString().split('T')[0];
      }
      // diffDays <= 1이면 단일 종일 이벤트 → endDate 불필요
    }

    return {
      date: startParsed.dateStr,
      title: summary,
      memo: description || undefined,
      startTime: startParsed.isAllDay ? undefined : startParsed.timeStr,
      endTime: (endParsed && !endParsed.isAllDay) ? endParsed.timeStr : undefined,
      color,
      uid,
      ...(endDateStr ? { endDate: endDateStr } : {}),
    } as Omit<Event, 'id'>;
  } catch (error) {
    console.error('iCal 파싱 오류:', error);
    return null;
  }
}

// 새 캘린더 생성 (MKCALENDAR)
async function createCalendarOnServer(
  serverUrl: string,
  username: string,
  password: string,
  calendarName: string,
  calendarColor?: string
): Promise<{ success: boolean; calendarUrl: string; displayName: string; color: string }> {
  console.log('createCalendarOnServer 시작:', { serverUrl, calendarName, calendarColor });
  
  // 1. Calendar Home URL 가져오기 (기존 fetchCalendars 로직 재사용)
  const calendars = await fetchCalendars(serverUrl, username, password);
  if (calendars.length === 0) {
    throw new Error('캘린더 홈 URL을 찾을 수 없습니다.');
  }
  
  // Calendar Home URL 추출 (첫 번째 캘린더 URL에서 추출)
  const firstCalUrl = calendars[0].url;
  const urlObj = new URL(firstCalUrl);
  const pathParts = urlObj.pathname.split('/').filter(p => p);
  // 일반적으로 /123456789/calendars/calendar-id 형태
  // Calendar Home은 /123456789/calendars/
  const calendarsIndex = pathParts.findIndex(p => p === 'calendars');
  if (calendarsIndex === -1) {
    throw new Error('캘린더 경로 형식을 파악할 수 없습니다.');
  }
  const calendarHomePath = '/' + pathParts.slice(0, calendarsIndex + 1).join('/') + '/';
  const calendarHomeUrl = `${urlObj.protocol}//${urlObj.host}${calendarHomePath}`;
  
  console.log('Calendar Home URL:', calendarHomeUrl);
  
  // 2. 새 캘린더 ID 생성 (UUID)
  const newCalendarId = crypto.randomUUID().toUpperCase();
  const newCalendarUrl = `${calendarHomeUrl}${newCalendarId}/`;
  
  console.log('새 캘린더 URL:', newCalendarUrl);
  
  // 3. MKCALENDAR 요청 본문 생성
  const color = calendarColor || '#3b82f6';
  const mkcalendarBody = `<?xml version="1.0" encoding="UTF-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(calendarName)}</D:displayname>
      <A:calendar-color>${color}</A:calendar-color>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

  // 4. MKCALENDAR 요청 전송
  const response = await fetchWithRedirect(newCalendarUrl, {
    method: 'MKCALENDAR',
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Authorization': `Basic ${base64Encode(`${username.trim()}:${password.trim()}`)}`,
      'User-Agent': 'iOS/17.0 (21A329) accountsd/1.0',
    },
    body: mkcalendarBody,
  });

  console.log('MKCALENDAR 응답 상태:', response.status);
  
  if (response.status === 201) {
    // 성공
    return {
      success: true,
      calendarUrl: newCalendarUrl,
      displayName: calendarName,
      color: color,
    };
  } else if (response.status === 207) {
    // Multi-Status 응답 (성공일 수 있음)
    const responseText = await response.text();
    console.log('MKCALENDAR 207 응답:', responseText.substring(0, 500));
    // 성공으로 간주
    return {
      success: true,
      calendarUrl: newCalendarUrl,
      displayName: calendarName,
      color: color,
    };
  } else {
    const errorText = await response.text();
    console.error('MKCALENDAR 실패:', response.status, errorText.substring(0, 500));
    throw new Error(`캘린더 생성 실패: HTTP ${response.status}`);
  }
}

// XML 특수문자 이스케이프
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
