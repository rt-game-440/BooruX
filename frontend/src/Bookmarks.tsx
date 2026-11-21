import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchPosts, setPostBookmark } from './feed';
import type { Post, PostsResponse } from './feed';
import { readPostCache, writePostCache } from './post-cache';
import { useToast } from './toast';

type BookmarkState = {
  snapshot: PostsResponse;
  ready: boolean;
  loading: boolean;
  error: string;
  pending: ReadonlySet<string>;
  refresh: () => Promise<void>;
  toggle: (id: string, members: Post[]) => Promise<void>;
  clear: () => void;
};

const groupKey = (post: Post) => post.parentId || post.id;

// 属于某个帖子组的收藏项：与组 id 同族，或本身就是组成员。
function inGroup(post: Post, id: string, memberIds: Set<string>) {
  return groupKey(post) === id || memberIds.has(post.id);
}

// 乐观取消收藏：移出整组，并返回被移出的项与它们原本的位置，供失败回滚或撤销时插回。
export function removeGroup(posts: Post[], id: string, members: Post[]): { posts: Post[]; removed: Post[]; index: number } {
  const memberIds = new Set(members.map(post => post.id));
  const index = posts.findIndex(post => inGroup(post, id, memberIds));
  const removed = posts.filter(post => inGroup(post, id, memberIds));
  return { posts: posts.filter(post => !inGroup(post, id, memberIds)), removed, index: Math.max(index, 0) };
}

// 乐观收藏 / 撤销：把整组插到指定位置（默认列表最前），已存在的项不重复。
export function insertGroup(posts: Post[], group: Post[], index = 0): Post[] {
  const known = new Set(posts.map(post => post.id));
  const fresh = group.filter(post => !known.has(post.id));
  const at = Math.min(Math.max(index, 0), posts.length);
  return [...posts.slice(0, at), ...fresh, ...posts.slice(at)];
}

const BookmarkContext = createContext<BookmarkState | null>(null);

export function BookmarkProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PostsResponse>(() =>
    readPostCache('favorites:default')?.data || { success: true, posts: [] });
  const snapshotRef = useRef(snapshot);
  const [ready, setReady] = useState(() => Boolean(readPostCache('favorites:default')));
  const [loading, setLoading] = useState(() => !readPostCache('favorites:default'));
  const [error, setError] = useState('');
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const toast = useToast();
  const request = useRef<Promise<void> | null>(null);
  const revision = useRef(0);

  const replace = useCallback((data: PostsResponse) => {
    snapshotRef.current = data;
    setSnapshot(data);
    writePostCache('favorites:default', data);
  }, []);

  // 设置改变后丢弃可能属旧分级的收藏快照，并作废进行中的旧请求。
  const clear = useCallback(() => {
    revision.current++;
    request.current = null;
    replace({ success: true, posts: [] });
    setReady(false);
    setLoading(true);
  }, [replace]);

  const refresh = useCallback((): Promise<void> => {
    if (pendingRef.current.size) return Promise.resolve();
    if (request.current) return request.current;
    const started = revision.current;
    setLoading(true);
    setError('');
    request.current = fetchPosts('/api/profiles/default/bookmarks', new AbortController().signal, 'bookmarks')
      .then(data => {
        if (started !== revision.current) return;
        replace(data);
        setReady(true);
      })
      .catch(() => {
        if (started === revision.current) setError('收藏列表加载失败，请重试。');
      })
      .finally(() => {
        if (started === revision.current) {
          request.current = null;
          setLoading(false);
        }
      });
    return request.current;
  }, [replace]);

  // 乐观更新：先改本地快照并立即反馈，请求失败再回滚。只锁正在请求的那个帖子组。
  const setBookmarked = useCallback(async (id: string, members: Post[], want: boolean, at = 0): Promise<void> => {
    if (pendingRef.current.has(id) || !members.length) return;
    const memberIds = new Set(members.map(post => post.id));
    const before = snapshotRef.current.posts;
    const saved = before.find(post => inGroup(post, id, memberIds));
    if (Boolean(saved) === want) return;
    const target = saved || members.find(post => post.id === id) || members[0];
    let removed: Post[] = [];
    let index = at;
    if (want) {
      replace({ success: true, posts: insertGroup(before, members.map(post => ({ ...post, isBookmarked: true })), at) });
    } else {
      const result = removeGroup(before, id, members);
      removed = result.removed;
      index = result.index;
      replace({ success: true, posts: result.posts });
    }
    setReady(true);
    revision.current++;
    pendingRef.current.add(id);
    setPending(new Set(pendingRef.current));
    try {
      const post = await setPostBookmark(target.id, want);
      if (want) replace({ success: true, posts: snapshotRef.current.posts.map(item => (item.id === post.id ? post : item)) });
      setError('');
      if (want) toast.show({ message: '收藏成功', tone: 'success' });
      else toast.show({ message: '已取消收藏', tone: 'success', action: { label: '撤销', run: () => { void undo(); } } });
    } catch {
      const latest = snapshotRef.current.posts;
      replace({ success: true, posts: want ? removeGroup(latest, id, members).posts : insertGroup(latest, removed, index) });
      toast.show({ message: want ? '收藏失败，已恢复原状' : '取消收藏失败，已恢复原状', tone: 'error' });
    } finally {
      pendingRef.current.delete(id);
      setPending(new Set(pendingRef.current));
    }
    // 撤销：把保存下来的整组成员按原位置重新收藏；失败时发错误 toast（由 setBookmarked 的回滚分支负责）。
    async function undo() {
      await setBookmarked(id, members, true, index);
    }
  }, [replace, toast]);

  const toggle = useCallback(async (id: string, members: Post[]) => {
    const memberIds = new Set(members.map(post => post.id));
    const saved = snapshotRef.current.posts.some(post => inGroup(post, id, memberIds));
    await setBookmarked(id, members, !saved);
  }, [setBookmarked]);

  return (
    <BookmarkContext.Provider value={{ snapshot, ready, loading, error, pending, refresh, toggle, clear }}>
      {children}
    </BookmarkContext.Provider>
  );
}

export function useBookmarks() {
  const state = useContext(BookmarkContext);
  if (!state) throw new Error('收藏状态必须在 BookmarkProvider 内使用');
  return state;
}
