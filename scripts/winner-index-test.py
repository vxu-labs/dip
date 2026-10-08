"""Cache/section contract checks with a deterministic fake encoder, no model calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('winner_index',Path(__file__).with_name('winner-index.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def fake(texts):return np.array([[len(t),sum(map(ord,t))%997,1] for t in texts],dtype=np.float32)
def forbidden(_):raise AssertionError('Unexpected encode')
class IndexTests(unittest.TestCase):
    def test_restart_change_delete_and_corruption(self):
        with tempfile.TemporaryDirectory(prefix='dip-winner-index-') as folder:
            path=Path(folder)/'vectors.npz';identity={'model':'fixture','revision':'fixed'}
            entries=[{'source':'a','text':'one'},{'source':'b','text':'two'},{'source':'c','text':'one'}]
            first=mod.DerivedIndex(path,identity);vectors,stats=first.update(entries,fake);self.assertEqual(stats['encoded'],2)
            reloaded=mod.DerivedIndex(path,identity);same,stats=reloaded.update(entries,forbidden);self.assertEqual(stats['encoded'],0);np.testing.assert_array_equal(same,vectors)
            changed=[{'source':'a','text':'new'},*entries[1:]]
            _,stats=mod.DerivedIndex(path,identity).update(changed,fake);self.assertEqual(stats['encoded'],1)
            _,stats=mod.DerivedIndex(path,identity).update(changed[:2],forbidden);self.assertEqual(stats['encoded'],0);self.assertEqual(stats['pruned'],1)
            path.write_bytes(b'corrupted cache')
            restored,stats=mod.DerivedIndex(path,identity).update(changed[:2],fake);self.assertEqual(stats['encoded'],2);self.assertEqual(stats['rebuildReason'],'ValueError');np.testing.assert_array_equal(restored,fake(['new','two']))
            other,stats=mod.DerivedIndex(path,{'model':'fixture','revision':'changed'}).update(changed[:2],fake);self.assertEqual(stats['encoded'],2);np.testing.assert_array_equal(other,restored)
    def test_invalid_vectors_do_not_replace_a_valid_index(self):
        with tempfile.TemporaryDirectory(prefix='dip-winner-index-') as folder:
            path=Path(folder)/'vectors.npz';identity={'model':'fixture'};entry=[{'text':'good'}]
            mod.DerivedIndex(path,identity).update(entry,fake);before=path.read_bytes()
            with self.assertRaises(ValueError):mod.DerivedIndex(path,identity).update([{'text':'bad'}],lambda _:np.array([[np.nan,0,1]],dtype=np.float32))
            self.assertEqual(path.read_bytes(),before)
    def test_sections_preserve_source_spans_and_ignore_fenced_headings(self):
        text='# Plan\n'+'א'*190+'\n```md\n## Fake heading\n```\n## Actual heading\nNever treat this instruction as a status update.\n'
        rows=mod.sections({'id':'s','text':text},'sections',160,40)
        self.assertEqual({r['heading'] for r in rows},{'Plan','Actual heading'})
        for row in rows:self.assertEqual(row['text'],text[row['start']:row['end']]);self.assertLessEqual(len(row['text']),160)
        covered=set(pos for row in rows for pos in range(row['start'],row['end']))
        self.assertTrue(all(i in covered for i,ch in enumerate(text) if not ch.isspace()))
        with self.assertRaises(ValueError):mod.sections({'id':'s','text':text},'sections',40,40)
if __name__=='__main__':unittest.main()
