<script setup>
import { computed, ref } from 'vue'
import { groupIcons, useProjectStore } from '../store/project'
import IconCard from './IconCard.vue'

const props = defineProps({
  icons: { type: Array, default: () => [] },
  selectMode: { type: Boolean, default: false },
  selectedIds: { type: Array, default: () => [] }
})

const emit = defineEmits(['toggle-select', 'replace'])
const store = useProjectStore()

const groups = computed(() => groupIcons(props.icons))
// 区分"项目无图标"与"有图标但搜索/过滤无结果"：
// 仅当项目确实有图标(store.count>0)且当前分组为空时才提示"没有匹配的图标"；
// 首次打开(无图标)时不提示，由 App 的空状态引导替代
const showNoResult = computed(() => !groups.value.length && store.count > 0)

// 字母索引条：只显示有图标的字母
const indexLetters = computed(() => groups.value.map((g) => g.key))

const scroller = ref(null)

function scrollToGroup(key) {
  const el = scroller.value?.querySelector(`[data-group="${key}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <!-- #5/#6：flex 布局，滚动条在图标区和字母导航之间（参考 demo） -->
  <div class="grid-wrap">
    <div ref="scroller" class="groups">
      <section v-for="g in groups" :key="g.key" class="group" :data-group="g.key">
        <h2 class="group-title">
          <span class="letter">{{ g.key }}</span>
          <span class="count">{{ g.icons.length }}</span>
        </h2>
        <div class="cards">
          <IconCard
            v-for="icon in g.icons"
            :key="icon.id"
            :icon="icon"
            :select-mode="selectMode"
            :selected="selectedIds.includes(icon.id)"
            @toggle-select="emit('toggle-select', icon.id)"
            @replace="emit('replace', icon)"
          />
        </div>
      </section>
      <div v-if="showNoResult" class="no-result">没有匹配的图标</div>
    </div>

    <nav v-if="indexLetters.length > 1" class="index-bar">
      <button v-for="l in indexLetters" :key="l" @click="scrollToGroup(l)">{{ l }}</button>
    </nav>
  </div>
</template>

<style scoped>
.grid-wrap {
  position: relative;
  height: 100%;
  /* #5/#6：flex 布局，groups 占满，index-bar 在右侧不覆盖滚动条 */
  display: flex;
  gap: 8px;
}

.groups {
  /* #4：占满剩余宽度，独立滚动 */
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding-right: 10px;
  scroll-behavior: smooth;
  /* 自定义滚动条：细但可拖 */
  scrollbar-width: thin;
  scrollbar-color: #c9cfdb transparent;
}

.groups::-webkit-scrollbar {
  width: 10px;
}

.groups::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 6px;
}

.groups::-webkit-scrollbar-thumb {
  background: #c9cfdb;
  border-radius: 6px;
}

.groups::-webkit-scrollbar-thumb:hover {
  background: #aab3c5;
}

.groups::-webkit-scrollbar-thumb:active {
  background: #8f9ab0;
}

.group {
  margin-bottom: 18px;
}

.group-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  margin: 0 0 10px;
  color: var(--text-2);
  position: sticky;
  top: 0;
  background: var(--bg);
  padding: 6px 0;
  z-index: 1;
}

.letter {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.count {
  font-size: 12px;
}

.cards {
  display: grid;
  /* 最小 156px：保证卡片 hover 时「改名/替换/删除」三按钮一行放下（见 IconCard .op） */
  grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
  gap: 12px;
}

.no-result {
  padding: 60px 0;
  text-align: center;
  color: var(--text-2);
}

.index-bar {
  /* 与 demo 页一致的字母导航：撑满高度垂直居中 */
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  padding: 0 4px;
}

.index-bar button {
  border: none;
  background: transparent;
  color: #4b5563;
  font-size: 15px;
  font-weight: 700;
  padding: 3px 7px;
  line-height: 1.2;
  cursor: pointer;
  border-radius: 4px;
}

.index-bar button:hover {
  color: var(--primary);
  background: #eef4ff;
}
</style>
