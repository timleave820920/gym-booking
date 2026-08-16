Component({
  options: {
    multipleSlots: true,
    pureDataPattern: /^_/
  },

  properties: {
    // 组件属性
    title: {
      type: String,
      value: ''
    },
    items: {
      type: Array,
      value: []
    }
  },

  data: {
    // 组件内部数据
    _cache: null
  },

  observers: {
    // 数据监听
    'items'(newItems) {
      // 当 items 变化时执行
    }
  },

  lifetimes: {
    attached() {
      // 组件进入页面节点树
    },
    detached() {
      // 组件从页面节点树移除，清理资源
    }
  },

  pageLifetimes: {
    show() {
      // 所在页面显示
    },
    hide() {
      // 所在页面隐藏
    }
  },

  methods: {
    // 组件方法
    onTap(e) {
      const { id } = e.currentTarget.dataset
      this.triggerEvent('itemtap', { id })
    }
  }
})
